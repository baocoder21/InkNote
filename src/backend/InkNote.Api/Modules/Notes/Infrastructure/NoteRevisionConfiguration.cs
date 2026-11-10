using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace InkNote.Api.Modules.Notes.Infrastructure;

public sealed class NoteRevisionConfiguration : IEntityTypeConfiguration<NoteRevision>
{
    public void Configure(EntityTypeBuilder<NoteRevision> builder)
    {
        builder.ToTable("note_revisions");
        builder.HasKey(r => r.Id);
        builder.Property(r => r.Title).HasMaxLength(NoteLimits.TitleMaxLength).IsRequired();
        builder.Property(r => r.Content).IsRequired();
        builder.Property(r => r.Reason).HasMaxLength(20).IsRequired();

        // Revisions go with their note (and their user): "delete forever" must leave no copy of the text behind.
        builder.HasOne<Note>().WithMany().HasForeignKey(r => r.NoteId).OnDelete(DeleteBehavior.Cascade);
        builder.HasOne<AppUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(r => new { r.NoteId, r.CreatedAt });
    }
}
