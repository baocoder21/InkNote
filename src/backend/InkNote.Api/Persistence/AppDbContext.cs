using InkNote.Api.Common;
using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Sync.Domain;
using InkNote.Api.Modules.Tags.Domain;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Persistence;

/// <summary>
/// One session with the database. Each DbSet maps to a table.
/// Entity mappings live next to their module (IEntityTypeConfiguration classes).
///
/// It inherits from IdentityUserContext: that adds the tables ASP.NET Core Identity needs for
/// accounts (users, user_claims, user_logins, user_tokens) and the DbSet "Users".
///
/// WHO MAY SEE WHAT is decided HERE, once: notes, notebooks and tags carry a global query
/// filter "UserId = the current user", which EF Core adds to EVERY query on them. A service
/// cannot forget it, so one user can never read another user's data by accident.
/// </summary>
public sealed class AppDbContext(DbContextOptions<AppDbContext> options, ICurrentUser currentUser)
    : IdentityUserContext<AppUser, Guid>(options)
{
    public DbSet<Note> Notes => Set<Note>();
    public DbSet<Notebook> Notebooks => Set<Notebook>();
    public DbSet<Tag> Tags => Set<Tag>();
    public DbSet<RefreshToken> RefreshTokens => Set<RefreshToken>();
    public DbSet<NoteRevision> NoteRevisions => Set<NoteRevision>();
    public DbSet<SyncTombstone> SyncTombstones => Set<SyncTombstone>();
    public DbSet<SyncOperationRecord> SyncOperations => Set<SyncOperationRecord>();
    // No DbSet for NoteTag: it is only reached through Note.Tags.

    // Read by the query filters below; EF Core re-evaluates it for every query (it is a
    // parameter of the SQL, not a constant baked into the model).
    private Guid? CurrentUserId => currentUser.UserId;

    /// <summary>
    /// The current user's deleted notes (the trash). The normal filter hides deleted notes, so the
    /// trash has to switch filters off. Doing that here, with the owner condition written once
    /// next to it, keeps "IgnoreQueryFilters" from ever dropping the owner check by accident.
    /// </summary>
    public IQueryable<Note> TrashedNotes =>
        Notes.IgnoreQueryFilters().Where(n => CurrentUserId != null && n.UserId == CurrentUserId && n.IsDeleted);

    /// <summary>
    /// ALL the current user's notes, the deleted ones too. Synchronization has to tell other devices about deletions.
    /// Same idea as TrashedNotes: the owner check is written here, next to the IgnoreQueryFilters.
    /// </summary>
    public IQueryable<Note> NotesIncludingDeleted =>
        Notes.IgnoreQueryFilters().Where(n => CurrentUserId != null && n.UserId == CurrentUserId);

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder); // the Identity tables

        // Full-text search needs two PostgreSQL extensions (the migration creates them): unaccent (ignore
        // accents) and pg_trgm (similarity of words, so a typo still finds the note).
        modelBuilder.HasPostgresExtension("unaccent").HasPostgresExtension("pg_trgm");
        modelBuilder.HasDbFunction(typeof(SearchFunctions).GetMethod(nameof(SearchFunctions.Unaccent), [typeof(string)])!)
            .HasName("f_unaccent");
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(AppDbContext).Assembly);

        // Table names in the same snake_case style as ours (the other Identity tables).
        modelBuilder.Entity<IdentityUserClaim<Guid>>().ToTable("user_claims");
        modelBuilder.Entity<IdentityUserLogin<Guid>>().ToTable("user_logins");
        modelBuilder.Entity<IdentityUserToken<Guid>>().ToTable("user_tokens");

        // "CurrentUserId != null" first: with no signed-in user the filter matches NOTHING (without it,
        // "user_id = NULL" semantics could match the ownerless legacy rows).
        modelBuilder.Entity<Note>().HasQueryFilter(n =>
            CurrentUserId != null && n.UserId == CurrentUserId && !n.IsDeleted); // owner AND not soft-deleted
        modelBuilder.Entity<Notebook>().HasQueryFilter(n => CurrentUserId != null && n.UserId == CurrentUserId);
        modelBuilder.Entity<Tag>().HasQueryFilter(t => CurrentUserId != null && t.UserId == CurrentUserId);
        modelBuilder.Entity<NoteRevision>().HasQueryFilter(r => CurrentUserId != null && r.UserId == CurrentUserId);
        modelBuilder.Entity<SyncTombstone>().HasQueryFilter(t => CurrentUserId != null && t.UserId == CurrentUserId);
        modelBuilder.Entity<SyncOperationRecord>().HasQueryFilter(r => CurrentUserId != null && r.UserId == CurrentUserId);
    }
}
