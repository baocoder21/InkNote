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

        // SYNCHRONIZATION. The database stamps every insert and update with the next number of one global sequence
        // (sync_seq) and the time (sync_at), by a trigger created in the migration "AddSync". A device asks for
        // "everything after number N". Shadow properties: the domain class does not know them; EF only reads them.
        builder.Property<long>("SyncSeq").HasColumnName("sync_seq").ValueGeneratedOnAddOrUpdate();
        builder.Property<DateTimeOffset>("SyncAt").HasColumnName("sync_at").ValueGeneratedOnAddOrUpdate();
        builder.HasIndex("UserId", "SyncSeq");
        builder.Property(t => t.Name).HasMaxLength(TagLimits.NameMaxLength).IsRequired();
        builder.Property(t => t.NormalizedName).HasMaxLength(TagLimits.NameMaxLength).IsRequired();

        // Owner: deleting a user deletes their tags.
        builder.HasOne<AppUser>().WithMany().HasForeignKey(t => t.UserId).OnDelete(DeleteBehavior.Cascade);

        // The database itself guarantees unique names (ignoring case) PER USER, even if two requests
        // race: two users may both have a tag called "work".
        builder.HasIndex(t => new { t.UserId, t.NormalizedName }).IsUnique();
    }
}
