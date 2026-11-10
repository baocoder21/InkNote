using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Sync.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace InkNote.Api.Modules.Sync.Infrastructure;

public sealed class SyncTombstoneConfiguration : IEntityTypeConfiguration<SyncTombstone>
{
    public void Configure(EntityTypeBuilder<SyncTombstone> builder)
    {
        builder.ToTable("sync_tombstones");
        builder.HasKey(t => t.Id);
        builder.Property(t => t.Id).HasDefaultValueSql("gen_random_uuid()");
        builder.Property(t => t.Entity).HasMaxLength(20).IsRequired();

        // Filled by the database (the trigger inserts the row, the defaults give the order of changes).
        builder.Property(t => t.SyncSeq).HasDefaultValueSql("nextval('sync_seq')").ValueGeneratedOnAdd();
        builder.Property(t => t.SyncAt).HasDefaultValueSql("clock_timestamp()").ValueGeneratedOnAdd();

        // No foreign key to users on purpose: when a user is deleted, the cascade deletes their notes, and the
        // trigger then writes tombstones for them; a foreign key would refuse rows pointing at a vanishing user.
        builder.HasIndex(t => new { t.UserId, t.SyncSeq });
    }
}

public sealed class SyncOperationRecordConfiguration : IEntityTypeConfiguration<SyncOperationRecord>
{
    public void Configure(EntityTypeBuilder<SyncOperationRecord> builder)
    {
        builder.ToTable("sync_operations");
        builder.HasKey(r => new { r.UserId, r.OpId }); // an OpId only has to be unique within one user
        builder.Property(r => r.Result).HasColumnType("jsonb").IsRequired();
        builder.HasOne<AppUser>().WithMany().HasForeignKey(r => r.UserId).OnDelete(DeleteBehavior.Cascade);
    }
}
