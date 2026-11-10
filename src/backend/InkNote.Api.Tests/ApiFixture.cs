using System.Net.Http.Headers;
using System.Net.Http.Json;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
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

    public async Task InitializeAsync()
    {
        await _database.StartAsync();

        // Apply the real migrations to the empty test database.
        using var scope = Services.CreateScope();
        await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder) =>
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
    Task IAsyncLifetime.DisposeAsync() => _database.DisposeAsync().AsTask();
}
