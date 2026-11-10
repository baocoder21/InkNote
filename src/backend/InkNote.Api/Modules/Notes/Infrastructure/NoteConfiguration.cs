using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
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
    }
}
