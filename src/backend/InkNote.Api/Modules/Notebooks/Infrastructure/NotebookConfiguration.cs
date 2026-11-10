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
