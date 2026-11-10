using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace InkNote.Api.Tests;

/// <summary>Register, sign in, refresh (rotation and reuse), sign out, and what a token has to look like.</summary>
public sealed class AuthApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private const string CookieName = "inknote_refresh";

    private static string NewEmail() => $"person-{Guid.NewGuid():N}@example.com";

    private static async Task<HttpResponseMessage> PostAsync(HttpClient client, string url, object? body = null) =>
        await client.PostAsJsonAsync(url, body);

    /// <summary>The refresh token value out of a Set-Cookie header, or null when the cookie is not set / deleted.</summary>
    private static string? RefreshCookieValue(HttpResponseMessage response)
    {
        var header = response.Headers.TryGetValues("Set-Cookie", out var all)
            ? all.FirstOrDefault(c => c.StartsWith(CookieName + "=", StringComparison.Ordinal))
            : null;
        var value = header?.Split(';')[0][(CookieName.Length + 1)..];
        return string.IsNullOrEmpty(value) ? null : value;
    }

    private static string SetCookieHeader(HttpResponseMessage response) =>
        response.Headers.GetValues("Set-Cookie").Single(c => c.StartsWith(CookieName + "=", StringComparison.Ordinal));

    /// <summary>A client without a cookie jar: it sends exactly the refresh token we hand it (a "thief" or a second tab).</summary>
    private HttpClient RawClient() => api.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });

    private static Task<HttpResponseMessage> RefreshWith(HttpClient raw, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        request.Headers.Add("Cookie", $"{CookieName}={token}");
        return raw.SendAsync(request);
    }

    // ---------- register ----------

    [Fact]
    public async Task Register_returns_an_access_token_and_sets_a_locked_down_refresh_cookie()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();

        var response = await PostAsync(client, "/api/auth/register", new RegisterRequest(email, ApiFixture.TestPassword));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.False(string.IsNullOrEmpty(auth.AccessToken));
        Assert.Equal(email, auth.User.Email);
        Assert.Equal(15 * 60, auth.ExpiresInSeconds);

        // The refresh token is NOT in the body, only in a cookie JavaScript cannot read.
        Assert.DoesNotContain("refresh", await response.Content.ReadAsStringAsync(), StringComparison.OrdinalIgnoreCase);
        var cookie = SetCookieHeader(response);
        Assert.Contains("httponly", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("samesite=lax", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("path=/api/auth", cookie, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("secure", cookie, StringComparison.OrdinalIgnoreCase); // plain http in tests
    }

    // ---------- remember me ----------

    /// <summary>true when the Set-Cookie header carries an expiry date, i.e. the cookie survives closing the browser.</summary>
    private static bool IsPersistentCookie(HttpResponseMessage response)
    {
        var header = SetCookieHeader(response);
        return header.Contains("expires=", StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Remember_me_makes_the_cookie_last_and_without_it_the_cookie_is_a_session_cookie()
    {
        var email = NewEmail();
        var register = await PostAsync(api.CreateAnonymousClient(), "/api/auth/register", new RegisterRequest(email, ApiFixture.TestPassword, RememberMe: true));
        Assert.True(IsPersistentCookie(register));

        var remembered = await PostAsync(api.CreateAnonymousClient(), "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: true));
        var sessionOnly = await PostAsync(api.CreateAnonymousClient(), "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: false));

        Assert.True(IsPersistentCookie(remembered));   // "expires=..." : kept after the browser closes
        Assert.False(IsPersistentCookie(sessionOnly)); // no expiry: the browser deletes it when it closes
    }

    [Fact]
    public async Task Without_the_field_a_sign_in_is_not_remembered()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();
        await ApiFixture.RegisterAsync(client, email, rememberMe: true);

        // The body has no "rememberMe" at all (an old client, or a hand-made request).
        var response = await client.PostAsync("/api/auth/login",
            new StringContent($$"""{"email":"{{email}}","password":"{{ApiFixture.TestPassword}}"}""", System.Text.Encoding.UTF8, "application/json"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.False(IsPersistentCookie(response));
    }

    [Fact]
    public async Task Refreshing_keeps_the_choice_made_at_sign_in()
    {
        var email = NewEmail();
        await ApiFixture.RegisterAsync(api.CreateAnonymousClient(), email);
        var remembered = api.CreateAnonymousClient();
        var sessionOnly = api.CreateAnonymousClient();
        await PostAsync(remembered, "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: true));
        await PostAsync(sessionOnly, "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: false));

        var refreshedRemembered = await PostAsync(remembered, "/api/auth/refresh");
        var refreshedSession = await PostAsync(sessionOnly, "/api/auth/refresh");

        Assert.True(IsPersistentCookie(refreshedRemembered)); // a remembered sign-in stays remembered...
        Assert.False(IsPersistentCookie(refreshedSession));   // ...and a browser session stays a browser session
        Assert.True(IsPersistentCookie(await PostAsync(remembered, "/api/auth/refresh"))); // also after many rotations
    }

    [Fact]
    public async Task The_server_side_lifetime_follows_the_choice_too()
    {
        var email = NewEmail();
        await ApiFixture.RegisterAsync(api.CreateAnonymousClient(), email);
        await PostAsync(api.CreateAnonymousClient(), "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: true));
        await PostAsync(api.CreateAnonymousClient(), "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: false));

        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var userId = (await db.Users.SingleAsync(u => u.Email == email)).Id;
        var tokens = await db.RefreshTokens.Where(t => t.UserId == userId).ToListAsync();

        var persistent = tokens.Where(t => t.IsPersistent).Select(t => t.ExpiresAt - t.CreatedAt).ToList();
        var session = tokens.Where(t => !t.IsPersistent).Select(t => t.ExpiresAt - t.CreatedAt).ToList();
        Assert.Contains(persistent, l => l >= TimeSpan.FromDays(29));  // remembered: 30 days
        Assert.NotEmpty(session);
        Assert.All(session, l => Assert.True(l <= TimeSpan.FromHours(13))); // not remembered: 12 hours
    }

    [Theory]
    [InlineData("not-an-email", "correct horse battery", "email")]
    [InlineData("", "correct horse battery", "email")]
    [InlineData("a@example.com", "short", "password")]
    [InlineData("b@example.com", "", "password")]
    public async Task Register_rejects_a_bad_email_or_password_with_400(string email, string password, string field)
    {
        var response = await PostAsync(api.CreateAnonymousClient(), "/api/auth/register", new RegisterRequest(email, password));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = (await response.Content.ReadFromJsonAsync<ValidationProblemDetails>())!;
        Assert.Contains(field, problem.Errors.Keys, StringComparer.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task Register_rejects_an_enormous_password_instead_of_hashing_it()
    {
        var response = await PostAsync(api.CreateAnonymousClient(), "/api/auth/register",
            new RegisterRequest(NewEmail(), new string('x', AuthLimits.PasswordMaxLength + 1)));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_with_a_taken_email_returns_409_even_when_the_case_differs()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();
        await ApiFixture.RegisterAsync(client, email);

        var again = await PostAsync(client, "/api/auth/register", new RegisterRequest(email.ToUpperInvariant(), ApiFixture.TestPassword));

        Assert.Equal(HttpStatusCode.Conflict, again.StatusCode);
    }

    [Fact]
    public async Task Passwords_and_refresh_tokens_are_stored_only_as_hashes()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();
        var response = await PostAsync(client, "/api/auth/register", new RegisterRequest(email, ApiFixture.TestPassword));
        var refreshToken = RefreshCookieValue(response)!;

        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var user = await db.Users.SingleAsync(u => u.Email == email);
        Assert.NotEqual(ApiFixture.TestPassword, user.PasswordHash);
        Assert.DoesNotContain(ApiFixture.TestPassword, user.PasswordHash!);

        var stored = await db.RefreshTokens.SingleAsync(t => t.UserId == user.Id);
        Assert.NotEqual(refreshToken, stored.TokenHash);
        Assert.Equal(TokenService.Hash(refreshToken), stored.TokenHash);
    }

    // ---------- login ----------

    [Fact]
    public async Task Login_with_the_right_password_works_and_the_token_opens_protected_endpoints()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();
        await ApiFixture.RegisterAsync(client, email);

        var response = await PostAsync(client, "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var auth = (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        var me = (await client.GetFromJsonAsync<AuthUserDto>("/api/auth/me"))!;
        Assert.Equal(email, me.Email);
        Assert.Equal(auth.User.Id, me.Id);
    }

    [Fact]
    public async Task Login_gives_the_same_answer_for_a_wrong_password_and_an_unknown_email()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();
        await ApiFixture.RegisterAsync(client, email);

        var wrongPassword = await PostAsync(client, "/api/auth/login", new LoginRequest(email, "definitely not it"));
        var unknownEmail = await PostAsync(client, "/api/auth/login", new LoginRequest(NewEmail(), "definitely not it"));

        Assert.Equal(HttpStatusCode.Unauthorized, wrongPassword.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, unknownEmail.StatusCode);
        // Same content: nothing tells an attacker which emails have an account (traceId differs per request).
        var a = (await wrongPassword.Content.ReadFromJsonAsync<ProblemDetails>())!;
        var b = (await unknownEmail.Content.ReadFromJsonAsync<ProblemDetails>())!;
        Assert.Equal((a.Status, a.Title, a.Detail, a.Type), (b.Status, b.Title, b.Detail, b.Type));
        Assert.Null(RefreshCookieValue(wrongPassword));
    }

    [Fact]
    public async Task Five_wrong_passwords_lock_the_account_even_for_the_right_password()
    {
        var client = api.CreateAnonymousClient();
        var email = NewEmail();
        await ApiFixture.RegisterAsync(client, email);

        for (var i = 0; i < 4; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/api/auth/login", new LoginRequest(email, "wrong wrong"))).StatusCode);
        }

        // The fifth failure locks the account.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(client, "/api/auth/login", new LoginRequest(email, "wrong wrong"))).StatusCode);
        // From now on even the correct password is refused.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await PostAsync(client, "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword))).StatusCode);
    }

    // ---------- access tokens ----------

    [Fact]
    public async Task Protected_endpoints_answer_401_without_a_token_with_garbage_and_with_a_token_signed_by_someone_else()
    {
        var client = api.CreateAnonymousClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/notes")).StatusCode);

        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", "garbage.garbage.garbage");
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/notes")).StatusCode);

        // A well-formed token for a real user id, signed with a key the API does not know.
        var forged = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "inknote-api",
            Audience = "inknote-web",
            Expires = DateTime.UtcNow.AddMinutes(5),
            Subject = new System.Security.Claims.ClaimsIdentity([new("sub", Guid.NewGuid().ToString())]),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey("an-attackers-own-key-0123456789-abcdefghijklmnopqrstuvwxyz"u8.ToArray()),
                SecurityAlgorithms.HmacSha256),
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", forged);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/notes")).StatusCode);
    }

    [Fact]
    public async Task A_token_for_another_audience_or_with_the_signature_cut_off_is_refused()
    {
        var user = api.CreateUserClient(out var auth);
        Assert.Equal(HttpStatusCode.OK, (await user.GetAsync("/api/notes")).StatusCode); // sanity: the real one works

        var withoutSignature = string.Join('.', auth.AccessToken.Split('.').Take(2)) + ".";
        user.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", withoutSignature);
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync("/api/notes")).StatusCode);

        // Same key, wrong audience: signature is valid, but the token was not meant for this API.
        var wrongAudience = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = "inknote-api",
            Audience = "some-other-app",
            Expires = DateTime.UtcNow.AddMinutes(5),
            Subject = new System.Security.Claims.ClaimsIdentity([new("sub", auth.User.Id.ToString())]),
            SigningCredentials = new SigningCredentials(
                new SymmetricSecurityKey("test-only-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz"u8.ToArray()),
                SecurityAlgorithms.HmacSha256),
        });
        user.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", wrongAudience);
        Assert.Equal(HttpStatusCode.Unauthorized, (await user.GetAsync("/api/notes")).StatusCode);
    }

    [Fact]
    public async Task Only_health_and_the_auth_endpoints_are_open_to_anonymous_callers()
    {
        var client = api.CreateAnonymousClient();

        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await PostAsync(client, "/api/auth/login", new LoginRequest("", ""))).StatusCode); // reachable, just invalid
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);
    }

    // ---------- refresh ----------

    [Fact]
    public async Task Refresh_uses_the_cookie_and_rotates_it()
    {
        var client = api.CreateAnonymousClient(); // keeps cookies like a browser
        var register = await PostAsync(client, "/api/auth/register", new RegisterRequest(NewEmail(), ApiFixture.TestPassword));
        var firstToken = RefreshCookieValue(register)!;

        var refresh = await PostAsync(client, "/api/auth/refresh"); // no body: only the cookie

        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);
        var auth = (await refresh.Content.ReadFromJsonAsync<AuthResponse>())!;
        Assert.False(string.IsNullOrEmpty(auth.AccessToken));
        var secondToken = RefreshCookieValue(refresh)!;
        Assert.NotEqual(firstToken, secondToken); // rotated: a NEW refresh token every time
    }

    [Fact]
    public async Task Refresh_without_a_cookie_answers_401()
    {
        var response = await PostAsync(api.CreateAnonymousClient(), "/api/auth/refresh");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task A_rotated_token_used_again_right_away_is_refused_but_does_not_end_the_session()
    {
        // Two tabs refreshing at the same moment send the same token: the loser gets 401, the winner's
        // new token must keep working (this is not theft).
        var client = api.CreateAnonymousClient();
        var register = await PostAsync(client, "/api/auth/register", new RegisterRequest(NewEmail(), ApiFixture.TestPassword));
        var firstToken = RefreshCookieValue(register)!;
        var raw = RawClient();

        var winner = await RefreshWith(raw, firstToken);
        var loser = await RefreshWith(raw, firstToken);

        Assert.Equal(HttpStatusCode.OK, winner.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, loser.StatusCode);
        var newToken = RefreshCookieValue(winner)!;
        Assert.Equal(HttpStatusCode.OK, (await RefreshWith(raw, newToken)).StatusCode); // the session survived
    }

    [Fact]
    public async Task Logout_revokes_the_refresh_token_and_clears_the_cookie()
    {
        var client = api.CreateAnonymousClient();
        var register = await PostAsync(client, "/api/auth/register", new RegisterRequest(NewEmail(), ApiFixture.TestPassword));
        var token = RefreshCookieValue(register)!;

        var logout = await PostAsync(client, "/api/auth/logout");

        Assert.Equal(HttpStatusCode.NoContent, logout.StatusCode);
        Assert.Null(RefreshCookieValue(logout)); // the cookie is deleted (empty value, expired)
        Assert.Equal(HttpStatusCode.Unauthorized, (await RefreshWith(RawClient(), token)).StatusCode); // the old token is dead
        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(client, "/api/auth/refresh")).StatusCode);
    }

    [Fact]
    public async Task Logout_without_a_session_is_not_an_error()
    {
        var response = await PostAsync(api.CreateAnonymousClient(), "/api/auth/logout");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    [Fact]
    public async Task Signing_in_twice_gives_two_independent_sessions_and_logout_only_ends_one()
    {
        var email = NewEmail();
        await ApiFixture.RegisterAsync(api.CreateAnonymousClient(), email);
        var phone = api.CreateAnonymousClient();
        var laptop = api.CreateAnonymousClient();
        await PostAsync(phone, "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword));
        await PostAsync(laptop, "/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword));

        await PostAsync(phone, "/api/auth/logout");

        Assert.Equal(HttpStatusCode.Unauthorized, (await PostAsync(phone, "/api/auth/refresh")).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await PostAsync(laptop, "/api/auth/refresh")).StatusCode);
    }

    [Fact]
    public async Task A_refresh_token_cannot_be_used_as_an_access_token()
    {
        var client = api.CreateAnonymousClient();
        var register = await PostAsync(client, "/api/auth/register", new RegisterRequest(NewEmail(), ApiFixture.TestPassword));
        var refreshToken = RefreshCookieValue(register)!;

        var raw = RawClient();
        raw.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshToken);

        Assert.Equal(HttpStatusCode.Unauthorized, (await raw.GetAsync("/api/notes")).StatusCode);
    }
}
