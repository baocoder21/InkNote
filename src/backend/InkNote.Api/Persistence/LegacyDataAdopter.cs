using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Persistence;

/// <summary>
/// Before Phase 5 notes, notebooks and tags had no owner. When the migration added the owner column
/// those rows got NULL, and since every query filters by the current user, nobody can see them.
/// The very first account ever registered adopts them (once), so a developer's test data survives
/// the move to accounts. It is a no-op on a clean database.
/// </summary>
public interface ILegacyDataAdopter
{
    Task AdoptAsync(Guid userId, CancellationToken ct);
}

public sealed class LegacyDataAdopter(AppDbContext db) : ILegacyDataAdopter
{
    public async Task AdoptAsync(Guid userId, CancellationToken ct)
    {
        // IgnoreQueryFilters: the filters would hide exactly the ownerless rows we are looking for.
        // Order matters only for readability: no foreign key links these three tables to each other's owner.
        await db.Notebooks.IgnoreQueryFilters().Where(n => n.UserId == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.UserId, userId), ct);
        await db.Tags.IgnoreQueryFilters().Where(t => t.UserId == null)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.UserId, userId), ct);
        await db.Notes.IgnoreQueryFilters().Where(n => n.UserId == null)
            .ExecuteUpdateAsync(s => s.SetProperty(n => n.UserId, userId), ct);
    }
}
