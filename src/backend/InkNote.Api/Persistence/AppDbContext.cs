using InkNote.Api.Modules.Notes.Domain;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Persistence;

/// <summary>
/// One session with the database. Each DbSet maps to a table.
/// Entity mappings live next to their module (IEntityTypeConfiguration classes).
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Note> Notes => Set<Note>();

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}
