using System.Net.Http.Headers;
using System.Net.Http.Json;
using InkNote.Api.Common.Storage;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Testcontainers.PostgreSql;

namespace InkNote.Api.Tests;

/// <summary>
/// Starts a throwaway PostgreSQL container and the whole API in memory.
/// Created once per test class and shared by its tests.
/// </summary>
public class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    public const string TestPassword = "correct horse battery";

    private readonly PostgreSqlContainer _database = new PostgreSqlBuilder("postgres:17").Build();

    /// <summary>Extra configuration for one test class (a subclass overrides this).</summary>
    protected virtual IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>();

    /// <summary>
    /// true = the fixture applies the migrations itself. A test of "the API migrates on startup" returns false and
    /// only lets the API start, to see what the API did on its own.
    /// </summary>
    protected virtual bool ApplyMigrations => true;

    public virtual async Task InitializeAsync()
    {
        await _database.StartAsync();

        if (!ApplyMigrations)
        {
            _ = Services; // starts the API (and with it the startup code of Program.cs)
            return;
        }

        // Apply the real migrations to the empty test database.
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

    /// <summary>true = attachments go to an in-memory fake (fast, no S3 server). A subclass returns false to use a real storage.</summary>
    protected virtual bool UseFakeStorage => true;

    /// <summary>The fake storage the API writes to (see <see cref="UseFakeStorage"/>): tests look inside it.</summary>
    public FakeObjectStorage Storage { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        if (UseFakeStorage)
        {
            builder.ConfigureTestServices(services =>
            {
                services.RemoveAll<IObjectStorage>();
                services.AddSingleton<IObjectStorage>(Storage);
            });
        }

        ConfigureSettings(builder);
    }

    private void ConfigureSettings(IWebHostBuilder builder) =>
        // Point the API at the test container instead of the development database.
        builder.ConfigureAppConfiguration((_, config) =>
        {
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _database.GetConnectionString(),
                ["Jwt:Key"] = "test-only-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz",
                // Tests sign in a lot from one IP address: the rate limit must not get in the way
                // (a dedicated test class turns it down to check that it works).
                ["RateLimiting:AuthPerMinute"] = "100000",
                // Changes are normally handed out only after a 2 second "settle window" (see SyncOptions). Tests want to see
                // them at once; a dedicated test class turns the window on to check that it works.
                ["Sync:SettleWindow"] = "00:00:00",
                // Real-time notifications are sent this long after the (here: zero) settle window.
                ["Sync:NotifyMargin"] = "00:00:00.050",
            });
            config.AddInMemoryCollection(Settings); // a subclass can override the values above
        });

    /// <summary>A client that is not signed in (cookies are kept like in a browser).</summary>
    public HttpClient CreateAnonymousClient() => CreateClient();

    /// <summary>Registers a NEW user and returns a client that sends that user's access token.</summary>
    public HttpClient CreateUserClient() => CreateUserClient(out _);

    public HttpClient CreateUserClient(out AuthResponse auth, string? email = null)
    {
        var client = CreateClient();
        auth = RegisterAsync(client, email ?? $"user-{Guid.NewGuid():N}@example.com").GetAwaiter().GetResult();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", auth.AccessToken);
        return client;
    }

    public static async Task<AuthResponse> RegisterAsync(HttpClient client, string email, string password = TestPassword, bool rememberMe = false)
    {
        var response = await client.PostAsJsonAsync("/api/auth/register", new RegisterRequest(email, password, rememberMe));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<AuthResponse>())!;
    }

    // Explicit implementation: the base factory has its own DisposeAsync (ValueTask).
    Task IAsyncLifetime.DisposeAsync() => DisposeAsyncCore();

    /// <summary>Releases what the fixture started. A subclass that starts more containers overrides this and calls the base.</summary>
    protected virtual async Task DisposeAsyncCore() => await _database.DisposeAsync();
}
