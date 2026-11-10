using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace InkNote.Api.Modules.Notes.Infrastructure;

public sealed class NoteConfiguration : IEntityTypeConfiguration<Note>
{
    public void Configure(EntityTypeBuilder<Note> builder)
    {
        builder.HasKey(n => n.Id);

        builder.Property(n => n.Title).HasMaxLength(NoteLimits.TitleMaxLength).IsRequired();
        builder.Property(n => n.Content).IsRequired(); // unlimited text column in PostgreSQL

        // On UPDATE, EF adds "WHERE version = <value we loaded>". If another request
        // changed the row first, 0 rows match and EF throws DbUpdateConcurrencyException.
        builder.Property(n => n.Version).IsConcurrencyToken();

        // Soft delete: every query on Notes automatically adds "WHERE NOT is_deleted".
        builder.HasQueryFilter(n => !n.IsDeleted);

        builder.HasIndex(n => n.UpdatedAt); // the list is sorted by UpdatedAt

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
