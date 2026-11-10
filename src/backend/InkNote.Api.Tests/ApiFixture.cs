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
public sealed class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly PostgreSqlContainer _database = new PostgreSqlBuilder("postgres:17").Build();

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
            config.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:Default"] = _database.GetConnectionString(),
            }));

    // Explicit implementation: the base factory has its own DisposeAsync (ValueTask).
    Task IAsyncLifetime.DisposeAsync() => _database.DisposeAsync().AsTask();
}
