using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace InkNote.Api.Tests;

/// <summary>
/// A container starts with an EMPTY database. With <c>Database:MigrateOnStartup = true</c> the API creates the tables
/// itself before serving (docker-compose.yml sets it). These fixtures let ONLY the API touch the empty database.
/// </summary>
public sealed class MigratingFixture : ApiFixture
{
    protected override bool ApplyMigrations => false;

    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?> { ["Database:MigrateOnStartup"] = "true" };
}

public sealed class PassiveFixture : ApiFixture
{
    protected override bool ApplyMigrations => false;
}

public sealed class MigrateOnStartupTests(MigratingFixture api) : IClassFixture<MigratingFixture>
{
    [Fact]
    public async Task The_API_creates_the_whole_schema_by_itself_when_asked_to()
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var pending = await db.Database.GetPendingMigrationsAsync();
        var applied = await db.Database.GetAppliedMigrationsAsync();

        Assert.Empty(pending);
        Assert.NotEmpty(applied);
    }

    [Fact]
    public async Task The_migrated_API_really_works_a_user_can_register_and_save_a_note()
    {
        var client = api.CreateUserClient();

        var created = await client.PostAsJsonAsync("/api/notes", new { title = "First", content = "in a fresh database" });

        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
    }
}

public sealed class NoMigrationByDefaultTests(PassiveFixture api) : IClassFixture<PassiveFixture>
{
    [Fact]
    public async Task Without_the_setting_the_API_leaves_the_database_alone()
    {
        // In development the person runs `dotnet ef database update` by hand: the API must never do it behind their back.
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        var applied = await db.Database.GetAppliedMigrationsAsync();

        Assert.Empty(applied);
    }
}
