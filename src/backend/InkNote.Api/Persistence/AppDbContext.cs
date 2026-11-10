using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Domain;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Persistence;

/// <summary>
/// One session with the database. Each DbSet maps to a table.
/// Entity mappings live next to their module (IEntityTypeConfiguration classes).
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Notebook> Notebooks => Set<Notebook>();
    public DbSet<Tag> Tags => Set<Tag>();
    // No DbSet for NoteTag: it is only reached through Note.Tags.

    protected override void OnModelCreating(ModelBuilder modelBuilder) =>
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);
}
