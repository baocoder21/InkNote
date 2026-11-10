using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace InkNote.Api.Tests;

// Each class below needs the API configured differently, so each has its own fixture
// (a fixture = one API instance + one throwaway PostgreSQL container).

public sealed class ShortLivedTokensFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Jwt:AccessTokenLifetime"] = "00:00:03",
        ["Jwt:ClockSkew"] = "00:00:00", // no tolerance: "expired" means expired
        ["Jwt:RefreshTokenLifetime"] = "00:00:05", // "remember me"
        ["Jwt:SessionRefreshTokenLifetime"] = "00:00:02", // not remembered
    };
}

public sealed class NoGraceFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Jwt:RefreshReuseGrace"] = "00:00:00", // any reuse of a rotated token counts as theft
    };
}

public sealed class RateLimitedFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["RateLimiting:AuthPerMinute"] = "3",
    };
}

public sealed class TokenExpiryTests(ShortLivedTokensFixture api) : IClassFixture<ShortLivedTokensFixture>
{
    [Fact]
    public async Task An_expired_access_token_is_refused_and_a_refresh_gives_a_working_one()
    {
        // Warm-up with another user: the very first request pays for JIT and EF model building, which
        // must not eat into the few seconds our token lives.
        await api.CreateUserClient().GetAsync("/api/notes");

        var client = api.CreateAnonymousClient();
        var auth = await ApiFixture.RegisterAsync(client, $"expiry-{Guid.NewGuid():N}@example.com", rememberMe: true); // remembered: its refresh token lives 5 s
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/notes")).StatusCode); // valid for 3 seconds

        await Task.Delay(3500);
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/notes")).StatusCode); // expired

        var refreshed = (await (await client.PostAsync("/api/auth/refresh", null)).Content.ReadFromJsonAsync<AuthResponse>())!;
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", refreshed.AccessToken);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/notes")).StatusCode);
    }

    [Fact]
    public async Task A_session_only_sign_in_ends_sooner_than_a_remembered_one()
    {
        var email = $"remember-{Guid.NewGuid():N}@example.com";
        await ApiFixture.RegisterAsync(api.CreateAnonymousClient(), email, rememberMe: true);
        var remembered = api.CreateAnonymousClient();
        var sessionOnly = api.CreateAnonymousClient();
        await remembered.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: true));
        await sessionOnly.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, ApiFixture.TestPassword, RememberMe: false));

        await Task.Delay(3000); // past the 2 s of a session-only token, within the 5 s of a remembered one

        Assert.Equal(HttpStatusCode.Unauthorized, (await sessionOnly.PostAsync("/api/auth/refresh", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await remembered.PostAsync("/api/auth/refresh", null)).StatusCode);
    }

    [Fact]
    public async Task An_expired_refresh_token_is_refused()
    {
        var client = api.CreateAnonymousClient();
        await ApiFixture.RegisterAsync(client, $"expiry-{Guid.NewGuid():N}@example.com");

        await Task.Delay(5500); // longer than the 5 second refresh token lifetime

        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/refresh", null)).StatusCode);
    }
}

public sealed class RefreshTokenTheftTests(NoGraceFixture api) : IClassFixture<NoGraceFixture>
{
    [Fact]
    public async Task Reusing_an_old_refresh_token_revokes_the_whole_session_including_the_newest_token()
    {
        var client = api.CreateAnonymousClient();
        var register = await client.PostAsJsonAsync("/api/auth/register",
            new RegisterRequest($"theft-{Guid.NewGuid():N}@example.com", ApiFixture.TestPassword));
        var stolen = register.Headers.GetValues("Set-Cookie").Single().Split(';')[0]["inknote_refresh=".Length..];

        // The real owner refreshes: the cookie jar now holds the NEXT token.
        var refresh = await client.PostAsync("/api/auth/refresh", null);
        Assert.Equal(HttpStatusCode.OK, refresh.StatusCode);

        // A thief replays the token that was copied earlier.
        var thief = api.CreateClient(new WebApplicationFactoryClientOptions { HandleCookies = false });
        var replay = new HttpRequestMessage(HttpMethod.Post, "/api/auth/refresh");
        replay.Headers.Add("Cookie", $"inknote_refresh={stolen}");
        Assert.Equal(HttpStatusCode.Unauthorized, (await thief.SendAsync(replay)).StatusCode);

        // The reuse proved that the token leaked, so the owner's newer token is revoked as well:
        // both must sign in again with the password.
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.PostAsync("/api/auth/refresh", null)).StatusCode);
    }
}

public sealed class AuthRateLimitTests(RateLimitedFixture api) : IClassFixture<RateLimitedFixture>
{
    [Fact]
    public async Task Too_many_sign_in_attempts_from_one_address_get_429()
    {
        var client = api.CreateAnonymousClient();
        var attempt = () => client.PostAsJsonAsync("/api/auth/login", new LoginRequest("nobody@example.com", "whatever whatever"));

        // 3 per minute are allowed (and answered normally: 401 wrong password)...
        for (var i = 0; i < 3; i++)
        {
            Assert.Equal(HttpStatusCode.Unauthorized, (await attempt()).StatusCode);
        }

        // ...the fourth is stopped before it even looks at the password.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await attempt()).StatusCode);
        // The limit covers register and refresh too (same policy), but not the rest of the API.
        Assert.Equal(HttpStatusCode.TooManyRequests, (await client.PostAsync("/api/auth/refresh", null)).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await client.GetAsync("/api/health")).StatusCode);
    }
}

/// <summary>
/// Notes made before accounts existed have no owner. The first account adopts them; later ones do not.
/// This class must contain ONE test: "first account" means "the very first in this database".
/// </summary>
public sealed class LegacyDataAdoptionTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    [Fact]
    public async Task The_first_account_adopts_ownerless_data_and_the_second_does_not_see_it()
    {
        // Rows as the old API created them: no user_id.
        var (notebookId, tagId, noteId) = (Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        using (var scope = api.Services.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO notebooks (id, name, created_at, updated_at) VALUES ({notebookId}, 'Old folder', now(), now());
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO tags (id, name, normalized_name, created_at) VALUES ({tagId}, 'old', 'OLD', now());
                """);
            await db.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO notes (id, title, content, created_at, updated_at, version, is_deleted, is_pinned, status)
                VALUES ({noteId}, 'Old note', 'written before accounts', now(), now(), 1, false, false, 'None');
                """);
        }

        // Before anyone registers, nobody can see them (there is nobody to ask).
        var first = api.CreateUserClient(); // the FIRST account
        var notes = (await first.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!;
        Assert.Contains(notes, n => n.Id == noteId);
        Assert.Equal("Old note", (await first.GetFromJsonAsync<NoteDto>($"/api/notes/{noteId}"))!.Title);
        Assert.Contains((await first.GetFromJsonAsync<List<InkNote.Api.Modules.Notebooks.Application.NotebookDto>>("/api/notebooks"))!, n => n.Id == notebookId);
        Assert.Contains((await first.GetFromJsonAsync<List<InkNote.Api.Modules.Tags.Application.TagDto>>("/api/tags"))!, t => t.Id == tagId);

        // A later account gets a clean slate.
        var second = api.CreateUserClient();
        Assert.Empty((await second.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!);
        Assert.Equal(HttpStatusCode.NotFound, (await second.GetAsync($"/api/notes/{noteId}")).StatusCode);
    }
}
