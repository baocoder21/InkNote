using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Tags.Application;
using InkNote.Api.Modules.Tags.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace InkNote.Api.Modules.Tags.Infrastructure;

public sealed class TagConfiguration : IEntityTypeConfiguration<Tag>
{
    public void Configure(EntityTypeBuilder<Tag> builder)
    {
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Name).HasMaxLength(TagLimits.NameMaxLength).IsRequired();
        builder.Property(t => t.NormalizedName).HasMaxLength(TagLimits.NameMaxLength).IsRequired();

        // Owner: deleting a user deletes their tags.
        builder.HasOne<AppUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);

        // The database itself guarantees unique names (ignoring case) PER USER, even if two requests
        // race: two users may both have a tag called "work".
        builder.HasIndex(t => new { t.UserId, t.NormalizedName }).IsUnique();
    }
}
