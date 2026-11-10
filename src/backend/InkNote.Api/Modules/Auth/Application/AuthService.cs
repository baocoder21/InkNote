using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Auth.Application;

public enum AuthStatus
{
    Ok,
    InvalidCredentials, // wrong email or password (the same answer for both: do not reveal which)
    LockedOut,          // too many wrong passwords: temporarily refused
    Unauthorized,       // refresh / token problems
    Duplicate,          // register: the email is taken
    Invalid,            // register: Identity rejected the email or password (Errors says why)
}

/// <summary>The refresh token, when it stops being valid, and whether the user asked to be remembered (the endpoint puts it in a cookie).</summary>
public sealed record IssuedRefreshToken(string Token, DateTimeOffset ExpiresAt, bool Persistent);

public sealed record AuthOutcome(
    AuthStatus Status,
    AuthResponse? Response = null,
    IssuedRefreshToken? Refresh = null,
    IReadOnlyDictionary<string, string[]>? Errors = null);

/// <summary>Use cases of the Auth module: register, sign in, refresh, sign out.</summary>
public sealed class AuthService(
    AppDbContext db,
    UserManager<AppUser> users,
    TokenService tokens,
    IOptions<JwtOptions> jwtOptions,
    ILegacyDataAdopter legacyData,
    TimeProvider clock)
{
    private JwtOptions Jwt => jwtOptions.Value;

    public async Task<AuthOutcome> RegisterAsync(RegisterRequest request, CancellationToken ct)
    {
        var email = request.Email.Trim();
        var isFirstUser = !await db.Users.AnyAsync(ct);
        var user = new AppUser { Id = Guid.CreateVersion7(), UserName = email, Email = email, CreatedAt = clock.GetUtcNow() };

        // Identity checks the password rules and the duplicate email, and stores only a HASH of the password.
        var created = await users.CreateAsync(user, request.Password);
        if (!created.Succeeded)
        {
            if (created.Errors.Any(e => e.Code is nameof(IdentityErrorDescriber.DuplicateEmail) or nameof(IdentityErrorDescriber.DuplicateUserName)))
            {
                return new AuthOutcome(AuthStatus.Duplicate);
            }

            return new AuthOutcome(AuthStatus.Invalid, Errors: created.Errors
                .GroupBy(e => e.Code.StartsWith("Password", StringComparison.Ordinal) ? "password" : "email")
                .ToDictionary(g => g.Key, g => g.Select(e => e.Description).ToArray()));
        }

        if (isFirstUser)
        {
            await legacyData.AdoptAsync(user.Id, ct);
        }

        return await IssueAsync(user, Guid.NewGuid(), request.RememberMe, ct);
    }

    public async Task<AuthOutcome> LoginAsync(LoginRequest request, CancellationToken ct)
    {
        var user = await users.FindByEmailAsync(request.Email.Trim());
        if (user is null)
        {
            // Hash anyway so "unknown email" takes as long as "wrong password": otherwise the
            // response time would tell an attacker which emails have an account.
            users.PasswordHasher.HashPassword(new AppUser(), request.Password);
            return new AuthOutcome(AuthStatus.InvalidCredentials);
        }

        if (await users.IsLockedOutAsync(user))
        {
            return new AuthOutcome(AuthStatus.LockedOut);
        }

        if (!await users.CheckPasswordAsync(user, request.Password))
        {
            await users.AccessFailedAsync(user); // counts the failure and locks the account after too many
            return new AuthOutcome(await users.IsLockedOutAsync(user) ? AuthStatus.LockedOut : AuthStatus.InvalidCredentials);
        }

        await users.ResetAccessFailedCountAsync(user);
        return await IssueAsync(user, Guid.NewGuid(), request.RememberMe, ct);
    }

    /// <summary>Trades a refresh token for a new access token AND a new refresh token (rotation).</summary>
    public async Task<AuthOutcome> RefreshAsync(string? refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(refreshToken))
        {
            return new AuthOutcome(AuthStatus.Unauthorized);
        }

        var hash = TokenService.Hash(refreshToken);
        var stored = await db.RefreshTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is null)
        {
            return new AuthOutcome(AuthStatus.Unauthorized);
        }

        var now = clock.GetUtcNow();
        if (stored.RevokedAt is { } revokedAt)
        {
            // A token that was already used is being presented again. Two tabs refreshing at the same
            // moment look exactly like that, so shortly after the rotation we just refuse. Later it
            // means someone kept a copy: every token of this sign-in is revoked.
            var justRotated = stored.RevokedByRotation && now - revokedAt <= Jwt.RefreshReuseGrace;
            if (!justRotated)
            {
                await RevokeFamilyAsync(stored.FamilyId, now, ct);
            }

            return new AuthOutcome(AuthStatus.Unauthorized);
        }

        if (stored.ExpiresAt <= now)
        {
            return new AuthOutcome(AuthStatus.Unauthorized);
        }

        // Rotate with ONE conditional UPDATE ("... WHERE revoked_at IS NULL"): if two requests race
        // with the same token, the database lets exactly one of them win.
        var rotated = await db.RefreshTokens
            .Where(t => t.Id == stored.Id && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.RevokedByRotation, true), ct);
        if (rotated == 0)
        {
            return new AuthOutcome(AuthStatus.Unauthorized); // lost the race: the winner has the new token
        }

        var user = await users.FindByIdAsync(stored.UserId.ToString());
        if (user is null || await users.IsLockedOutAsync(user))
        {
            await RevokeFamilyAsync(stored.FamilyId, now, ct);
            return new AuthOutcome(AuthStatus.Unauthorized);
        }

        // The new token inherits the choice made at sign-in: "remember me" stays remembered, a browser
        // session stays a browser session.
        return await IssueAsync(user, stored.FamilyId, stored.IsPersistent, ct);
    }

    /// <summary>Signs out: every refresh token of this sign-in stops working. Unknown tokens are ignored.</summary>
    public async Task LogoutAsync(string? refreshToken, CancellationToken ct)
    {
        if (string.IsNullOrEmpty(refreshToken))
        {
            return;
        }

        var hash = TokenService.Hash(refreshToken);
        var stored = await db.RefreshTokens.AsNoTracking().FirstOrDefaultAsync(t => t.TokenHash == hash, ct);
        if (stored is not null)
        {
            await RevokeFamilyAsync(stored.FamilyId, clock.GetUtcNow(), ct);
        }
    }

    private async Task<AuthOutcome> IssueAsync(AppUser user, Guid familyId, bool persistent, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var (accessToken, expiresIn) = tokens.CreateAccessToken(user, now);
        var refreshToken = TokenService.NewRefreshToken();
        var lifetime = Jwt.RefreshLifetimeFor(persistent);

        // Only the hash is stored; the token itself goes to the browser and is forgotten here.
        db.RefreshTokens.Add(RefreshToken.Create(user.Id, familyId, TokenService.Hash(refreshToken), persistent, now, lifetime));
        await db.SaveChangesAsync(ct);

        return new AuthOutcome(
            AuthStatus.Ok,
            new AuthResponse(accessToken, expiresIn, new AuthUserDto(user.Id, user.Email ?? string.Empty)),
            new IssuedRefreshToken(refreshToken, now + lifetime, persistent));
    }

    private Task<int> RevokeFamilyAsync(Guid familyId, DateTimeOffset now, CancellationToken ct) =>
        db.RefreshTokens
            .Where(t => t.FamilyId == familyId && t.RevokedAt == null)
            .ExecuteUpdateAsync(s => s
                .SetProperty(t => t.RevokedAt, now)
                .SetProperty(t => t.RevokedByRotation, false), ct);
}
