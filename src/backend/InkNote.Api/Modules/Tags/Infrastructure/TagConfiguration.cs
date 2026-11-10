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

        // The database itself guarantees unique names (ignoring case), even if two requests race.
        builder.HasIndex(t => t.NormalizedName).IsUnique();
    }
}
