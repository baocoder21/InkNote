namespace InkNote.Api.Modules.Auth.Domain;

/// <summary>
/// One refresh token that was handed out. The token itself (a long random string) is never
/// stored, only its SHA-256 hash: a copy of the database cannot be used to sign in.
///
/// Tokens are ROTATED: using one revokes it and issues the next one in the same "family"
/// (all tokens that descend from one sign-in). If an already used token shows up again, someone
/// has a copy of it, so the whole family is revoked.
/// </summary>
public sealed class RefreshToken
{
    private RefreshToken() { }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid FamilyId { get; private set; }
    public string TokenHash { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset ExpiresAt { get; private set; }
    public DateTimeOffset? RevokedAt { get; private set; }

    /// <summary>"Remember me": the sign-in (and every token rotated from it) lasts for days instead of one browser session.</summary>
    public bool IsPersistent { get; private set; }

    /// <summary>true when it was revoked because it was used (rotation), false for logout / reuse detection.</summary>
    public bool RevokedByRotation { get; private set; }

    public static RefreshToken Create(Guid userId, Guid familyId, string tokenHash, bool persistent, DateTimeOffset now, TimeSpan lifetime) => new()
    {
        Id = Guid.CreateVersion7(),
        UserId = userId,
        FamilyId = familyId,
        IsPersistent = persistent,
        TokenHash = tokenHash,
        CreatedAt = now,
        ExpiresAt = now + lifetime,
    };

    public bool IsActive(DateTimeOffset now) => RevokedAt is null && ExpiresAt > now;

    public void Revoke(DateTimeOffset now, bool byRotation)
    {
        if (RevokedAt is not null)
        {
            return; // already revoked: keep the first reason and time
        }

        RevokedAt = now;
        RevokedByRotation = byRotation;
    }
}
