using InkNote.Api.Common;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Modules.Tags.Domain;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace InkNote.Api.Modules.Tags.Application;

/// <summary>
/// Synchronization of tags. Tag names are unique per user (ignoring case). Two devices that each create a tag
/// "work" while offline would clash; instead of refusing the second one the server names it "work (2)": nothing
/// is lost and the user can rename it. Deleting a tag removes it from every note (the database cascades).
/// </summary>
internal sealed class TagSyncHandler(AppDbContext db, ICurrentUser user) : ISyncHandler
{
    public string Entity => SyncEntities.Tag;

    public async Task<IReadOnlyList<SyncChange>> PullAsync(long after, long before, int limit, CancellationToken ct)
    {
        var rows = await db.Tags.AsNoTracking()
            .Where(t => EF.Property<long>(t, "SyncSeq") > after && EF.Property<long>(t, "SyncSeq") < before)
            .OrderBy(t => EF.Property<long>(t, "SyncSeq"))
            .Take(limit)
            .Select(t => new { Dto = new TagDto(t.Id, t.Name), Seq = EF.Property<long>(t, "SyncSeq") })
            .ToListAsync(ct);

        return rows.Select(r => new SyncChange(r.Seq, Entity, r.Dto.Id, Deleted: false, Data: r.Dto)).ToList();
    }

    public Task<long?> OldestSeqSinceAsync(DateTimeOffset since, CancellationToken ct) =>
        db.Tags
            .Where(t => EF.Property<DateTimeOffset>(t, "SyncAt") > since)
            .Select(t => (long?)EF.Property<long>(t, "SyncSeq"))
            .MinAsync(ct);

    public async Task<SyncOpResult> ApplyAsync(SyncOperation operation, DateTimeOffset now, CancellationToken ct)
    {
        var tag = await db.Tags.FirstOrDefaultAsync(t => t.Id == operation.Id, ct);

        if (operation.Kind == SyncKinds.Delete)
        {
            if (tag is not null)
            {
                db.Tags.Remove(tag);
                await db.SaveChangesAsync(ct);
            }

            return new SyncOpResult(SyncStatuses.Applied);
        }

        string? name;
        try
        {
            name = new SyncPatch(operation.Data).GetString("name")?.Trim();
        }
        catch (FormatException ex)
        {
            return new SyncOpResult(SyncStatuses.Rejected, Error: ex.Message);
        }
        if (name is not null && (name.Length == 0 || name.Length > TagLimits.NameMaxLength))
        {
            return new SyncOpResult(SyncStatuses.Rejected, Error: $"The name must have 1 to {TagLimits.NameMaxLength} characters.");
        }

        if (tag is null)
        {
            if (name is null)
            {
                return new SyncOpResult(SyncStatuses.Rejected, Error: "A new tag needs a name.");
            }

            var created = Tag.Create(user.RequiredUserId, await FreeNameAsync(name, operation.Id, ct), now, operation.Id);
            db.Tags.Add(created);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                db.ChangeTracker.Clear();
                return new SyncOpResult(SyncStatuses.Rejected, Error: "This id or name is already in use. Try again.");
            }

            return new SyncOpResult(SyncStatuses.Applied, TagDto.From(created));
        }

        if (name is not null && name != tag.Name)
        {
            tag.Rename(await FreeNameAsync(name, tag.Id, ct));
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                db.ChangeTracker.Clear();
                return new SyncOpResult(SyncStatuses.Rejected, Error: "This name is already in use. Try again.");
            }
        }

        return new SyncOpResult(SyncStatuses.Applied, TagDto.From(tag));
    }

    // "work", or "work (2)", "work (3)"... the first name no OTHER tag of this user has.
    private async Task<string> FreeNameAsync(string wanted, Guid ownId, CancellationToken ct)
    {
        for (var n = 1; ; n++)
        {
            var suffix = n == 1 ? string.Empty : $" ({n})";
            var candidate = (wanted.Length + suffix.Length > TagLimits.NameMaxLength
                ? wanted[..(TagLimits.NameMaxLength - suffix.Length)]
                : wanted) + suffix;
            var normalized = Tag.Normalize(candidate);
            if (!await db.Tags.AnyAsync(t => t.NormalizedName == normalized && t.Id != ownId, ct))
            {
                return candidate;
            }
        }
    }
}
