using InkNote.Api.Modules.Attachments.Domain;
using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Notes.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace InkNote.Api.Modules.Attachments.Infrastructure;

public sealed class AttachmentConfiguration : IEntityTypeConfiguration<Attachment>
{
    public const int FileNameMaxLength = 255;

    public void Configure(EntityTypeBuilder<Attachment> builder)
    {
        builder.ToTable("attachments");
        builder.HasKey(a => a.Id);
        builder.Property(a => a.Id).ValueGeneratedNever(); // chosen by the client
        builder.Property(a => a.FileName).HasMaxLength(FileNameMaxLength).IsRequired();
        builder.Property(a => a.ContentType).HasMaxLength(100).IsRequired();
        builder.Property(a => a.StorageKey).HasMaxLength(100).IsRequired();

        builder.HasOne<AppUser>().WithMany().HasForeignKey(a => a.UserId).OnDelete(DeleteBehavior.Cascade);
        // When a note is deleted for good its attachment rows go with it (the objects are removed by
        // IAttachmentCleanup, which the Notes module calls first: the database cannot reach the storage).
        builder.HasOne<Note>().WithMany().HasForeignKey(a => a.NoteId).OnDelete(DeleteBehavior.Cascade);

        builder.HasIndex(a => a.UserId); // the storage quota adds up one user's files
        builder.HasIndex(a => a.NoteId);
    }
}
