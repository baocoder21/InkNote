using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using NpgsqlTypes;

namespace InkNote.Api.Modules.Notes.Infrastructure;

public sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    public void Configure(EntityTypeBuilder<Note> builder)
    {
        builder.HasKey(n => n.Id);

        // SYNCHRONIZATION. The database stamps every insert and update with the next number of one global sequence
        // (sync_seq) and the time (sync_at), by a trigger created in the migration "AddSync". A device asks for
        // "everything after number N". Shadow properties: the domain class does not know them; EF only reads them.
        builder.Property<long>("SyncSeq").HasColumnName("sync_seq").ValueGeneratedOnAddOrUpdate();
        builder.Property<DateTimeOffset>("SyncAt").HasColumnName("sync_at").ValueGeneratedOnAddOrUpdate();
        builder.HasIndex("UserId", "SyncSeq");

        builder.Property(n => n.Title).HasMaxLength(NoteLimits.TitleMaxLength).IsRequired();
        builder.Property(n => n.Content).IsRequired(); // unlimited text column in PostgreSQL

        // On UPDATE, EF adds "WHERE version = <value we loaded>". If another request
        // changed the row first, 0 rows match and EF throws DbUpdateConcurrencyException.
        builder.Property(n => n.Version).IsConcurrencyToken();

        // The query filter (owner AND not soft-deleted) is defined in AppDbContext: EF Core allows one filter
        // per entity and it needs the current user, which only the context knows.

        builder.HasIndex(n => n.UpdatedAt); // the list is sorted by UpdatedAt

        // FULL-TEXT SEARCH. "search_vector" is a column the DATABASE computes (GENERATED ... STORED) from the
        // title and the content every time they change, so it can never be stale. A tsvector is a list of the
        // words of a text (normalized, with positions). "simple" = no stemming and no stop words: PostgreSQL has
        // no Vietnamese dictionary, but Vietnamese words are separated by spaces, which is all "simple" needs.
        // f_unaccent makes the search ignore accents; setweight makes a hit in the title (A) count more than a
        // hit in the content (B). It is a SHADOW property: the column exists, the Note class does not know it.
        builder.Property<NpgsqlTsVector>(NoteSearch.VectorProperty)
            .HasColumnName("search_vector")
            .HasComputedColumnSql(
                "setweight(to_tsvector('simple', f_unaccent(title)), 'A') || setweight(to_tsvector('simple', f_unaccent(content)), 'B')",
                stored: true);
        // GIN = an inverted index: word -> the rows that contain it. This is what makes a search fast.
        // (The two trigram indexes for typo tolerance are expression indexes: see the migration.)
        builder.HasIndex(NoteSearch.VectorProperty).HasMethod("gin");

        // Owner: deleting a user deletes their notes. The index serves "all notes of this user".
        builder.HasOne<AppUser>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(n => n.UserId);

        // Stored as its name ("OnHold") rather than 0..4: readable in the database, and
        // reordering the enum can never silently change what existing rows mean.
        builder.Property(n => n.Status)
            .HasConversion<string>()
            .HasMaxLength(20)
            .HasDefaultValue(NoteStatus.None); // rows that existed before this column get "None"

        // One-to-many: one notebook has many notes. The Notebook type is only used here to
        // describe the foreign key (no navigation property on either side). If a notebook is
        // deleted, notes that point to it (including soft-deleted ones) get NotebookId = NULL.
        builder.HasOne<Notebook>()
            .WithMany()
            .HasForeignKey(n => n.NotebookId)
            .OnDelete(DeleteBehavior.SetNull);
        builder.HasIndex(n => n.NotebookId); // "notes in this notebook" is a common filter

        // One-to-many to the join rows; EF writes through the private "_tags" field.
        builder.HasMany(n => n.Tags)
            .WithOne()
            .HasForeignKey(t => t.NoteId)
            .OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(n => n.Tags).HasField("_tags");
    }
}

/// <summary>The join table that turns "note has many tags, tag has many notes" into rows.</summary>
public sealed class NoteTagConfiguration : IEntityTypeConfiguration<NoteTag>
{
    public void Configure(EntityTypeBuilder<NoteTag> builder)
    {
        builder.ToTable("note_tags");

        // Composite primary key: the same tag cannot be attached to a note twice.
        builder.HasKey(t => new { t.NoteId, t.TagId });

        // Deleting a tag removes its join rows (the tag disappears from every note).
        builder.HasOne<Tag>()
            .WithMany()
            .HasForeignKey(t => t.TagId)
            .OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(t => t.TagId); // "notes with this tag" looks up by TagId
    }
}
