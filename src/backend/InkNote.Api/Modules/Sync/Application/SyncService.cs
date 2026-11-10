using System.Text.Json;
using FluentValidation;
using InkNote.Api.Common;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Modules.Sync.Domain;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Sync.Application;

/// <summary>Settings under "Sync".</summary>
public sealed class SyncOptions
{
    public const string SectionName = "Sync";

    /// <summary>
    /// Changes younger than this are not handed out yet. Two requests can get their sequence numbers in one
    /// order and commit in the other; a device that pulled in between would move its cursor past the slower
    /// one and never see it. Waiting until a change is older than any transaction can last closes that gap.
    /// </summary>
    public TimeSpan SettleWindow { get; set; } = TimeSpan.FromSeconds(2);

    public int MaxOperationsPerPush { get; set; } = 50;
}

public static class SyncLimits
{
    public const int DefaultPullLimit = 200;
    public const int MaxPullLimit = 500;
}

/// <summary>GET /api/sync/pull?cursor=&amp;limit=</summary>
public sealed record PullQuery(long Cursor = 0, int Limit = SyncLimits.DefaultPullLimit);

public sealed class PullQueryValidator : AbstractValidator<PullQuery>
{
    public PullQueryValidator()
    {
        RuleFor(x => x.Cursor).GreaterThanOrEqualTo(0);
        RuleFor(x => x.Limit).InclusiveBetween(1, SyncLimits.MaxPullLimit);
    }
}

/// <param name="Cursor">Send this back next time: "give me what came after it".</param>
/// <param name="HasMore">true when the page was full: ask again right away.</param>
public sealed record PullResponse(IReadOnlyList<SyncChange> Changes, long Cursor, bool HasMore);

public sealed record PushRequest(IReadOnlyList<SyncOperation> Operations);

public sealed record OperationResultDto(Guid OpId, string Status, object? Entity, string? Error);

public sealed record PushResponse(IReadOnlyList<OperationResultDto> Results);

/// <summary>
/// The two halves of synchronization: a device PUSHES the changes it made, and PULLS the changes that happened
/// elsewhere. The work on each kind of data is done by the module that owns it (ISyncHandler); this class
/// orders, de-duplicates and paginates.
/// </summary>
public sealed class SyncService(
    AppDbContext db,
    ICurrentUser user,
    IEnumerable<ISyncHandler> handlers,
    IOptions<SyncOptions> options,
    TimeProvider clock)
{
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);
    private const int MaxAttempts = 3;

    private readonly Dictionary<string, ISyncHandler> _handlers = handlers.ToDictionary(h => h.Entity);

    public async Task<PullResponse> PullAsync(long cursor, int limit, CancellationToken ct)
    {
        // The database clock, not ours: the timestamps being compared were written by the database.
        var databaseNow = await db.Database.SqlQuery<DateTimeOffset>($"SELECT clock_timestamp() AS \"Value\"").SingleAsync(ct);
        var settledBefore = databaseNow - options.Value.SettleWindow;

        // Everything below `before` is old enough to be final. The first change that is still too young marks
        // the end of what may be handed out (a consistent prefix: nothing after it is given either).
        var before = long.MaxValue;
        foreach (var handler in _handlers.Values)
        {
            if (await handler.OldestSeqSinceAsync(settledBefore, ct) is { } youngest)
            {
                before = Math.Min(before, youngest);
            }
        }
        if (await db.SyncTombstones.Where(t => t.SyncAt > settledBefore).Select(t => (long?)t.SyncSeq).MinAsync(ct) is { } youngestTombstone)
        {
            before = Math.Min(before, youngestTombstone);
        }

        // Ask each source for one more than the page size: that tells whether there is another page.
        var all = new List<SyncChange>();
        foreach (var handler in _handlers.Values)
        {
            all.AddRange(await handler.PullAsync(cursor, before, limit + 1, ct));
        }
        var tombstones = await db.SyncTombstones.AsNoTracking()
            .Where(t => t.SyncSeq > cursor && t.SyncSeq < before)
            .OrderBy(t => t.SyncSeq)
            .Take(limit + 1)
            .ToListAsync(ct);
        all.AddRange(tombstones.Select(t => new SyncChange(t.SyncSeq, t.Entity, t.EntityId, Deleted: true, Data: null)));

        var ordered = all.OrderBy(c => c.Seq).ToList();
        var page = ordered.Take(limit).ToList();
        return new PullResponse(page, page.Count > 0 ? page[^1].Seq : cursor, HasMore: ordered.Count > limit);
    }

    public async Task<PushResponse> PushAsync(IReadOnlyList<SyncOperation> operations, CancellationToken ct)
    {
        var results = new List<OperationResultDto>(operations.Count);
        foreach (var operation in operations)
        {
            // In order: an operation may refer to something an earlier one created (a note in a new folder).
            var result = await ApplyOneAsync(operation, ct);
            results.Add(new OperationResultDto(operation.OpId, result.Status, result.Entity, result.Error));
        }

        return new PushResponse(results);
    }

    private async Task<SyncOpResult> ApplyOneAsync(SyncOperation operation, CancellationToken ct)
    {
        var userId = user.RequiredUserId;

        // Seen before (a retry after a lost answer)? Then do NOT apply it again: answer as before.
        var known = await db.SyncOperations.AsNoTracking().FirstOrDefaultAsync(r => r.OpId == operation.OpId, ct);
        if (known is not null)
        {
            return JsonSerializer.Deserialize<SyncOpResult>(known.Result, Json)!;
        }

        if (operation.OpId == Guid.Empty || operation.Id == Guid.Empty
            || operation.Kind is not (SyncKinds.Upsert or SyncKinds.Delete)
            || !_handlers.TryGetValue(operation.Entity ?? string.Empty, out var handler))
        {
            return await RememberAsync(userId, operation.OpId, new SyncOpResult(SyncStatuses.Rejected, Error: "Unknown entity or kind, or a missing id."), ct);
        }

        for (var attempt = 1; attempt <= MaxAttempts; attempt++)
        {
            try
            {
                // The change and the note that it was done are saved TOGETHER or not at all: otherwise a crash
                // in between would make the retry apply the change twice.
                await using var transaction = await db.Database.BeginTransactionAsync(ct);
                var result = await handler.ApplyAsync(operation, clock.GetUtcNow(), ct);
                db.SyncOperations.Add(new SyncOperationRecord(userId, operation.OpId, JsonSerializer.Serialize(result, Json), clock.GetUtcNow()));
                await db.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                return result;
            }
            catch (DbUpdateConcurrencyException)
            {
                // Somebody else saved the same row between our read and our write (another device, or the web
                // page). Read it again and redo the change on top of theirs.
            }
            finally
            {
                db.ChangeTracker.Clear(); // the next operation must not see leftovers of this one
            }
        }

        // Not remembered: the device may send it again later.
        return new SyncOpResult(SyncStatuses.Rejected, Error: "The data kept changing while this change was applied. Try again.");
    }

    private async Task<SyncOpResult> RememberAsync(Guid userId, Guid opId, SyncOpResult result, CancellationToken ct)
    {
        if (opId != Guid.Empty)
        {
            db.SyncOperations.Add(new SyncOperationRecord(userId, opId, JsonSerializer.Serialize(result, Json), clock.GetUtcNow()));
            await db.SaveChangesAsync(ct);
            db.ChangeTracker.Clear();
        }

        return result;
    }
}
