using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notebooks.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace InkNote.Api.Modules.Notebooks.Infrastructure;

public sealed class NotebookConfiguration : IEntityTypeConfiguration<Notebook>
{
    public void Configure(EntityTypeBuilder<Notebook> builder)
    {
        builder.HasKey(n => n.Id);

        // SYNCHRONIZATION. The database stamps every insert and update with the next number of one global sequence
        // (sync_seq) and the time (sync_at), by a trigger created in the migration "AddSync". A device asks for
        // "everything after number N". Shadow properties: the domain class does not know them; EF only reads them.
        builder.Property<long>("SyncSeq").HasColumnName("sync_seq").ValueGeneratedOnAddOrUpdate();
        builder.Property<DateTimeOffset>("SyncAt").HasColumnName("sync_at").ValueGeneratedOnAddOrUpdate();
        builder.HasIndex("UserId", "SyncSeq");
        builder.Property(n => n.Name).HasMaxLength(NotebookLimits.NameMaxLength).IsRequired();

        // Self-reference: ParentId points to another row of the same table (the tree).
        // Restrict: the database refuses to delete a notebook that still has children.
        builder.HasOne<Notebook>()
            .WithMany()
            .HasForeignKey(n => n.ParentId)
            .OnDelete(DeleteBehavior.Restrict);
        builder.HasIndex(n => n.ParentId);

        // Owner: deleting a user deletes their notebooks.
        builder.HasOne<AppUser>().WithMany().HasForeignKey(n => n.UserId).OnDelete(DeleteBehavior.Cascade);
        builder.HasIndex(n => n.UserId);
    }
}
