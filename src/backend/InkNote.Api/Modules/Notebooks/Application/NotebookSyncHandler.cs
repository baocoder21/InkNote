using InkNote.Api.Common;
using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Contracts;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace InkNote.Api.Modules.Notebooks.Application;

/// <summary>
/// Synchronization of notebooks. Notebooks have no version: two devices renaming the same folder is settled by
/// "the last one to arrive wins", which loses nothing important (a name). The same rules as the REST API hold:
/// no loops in the tree, and a folder that still has notes or sub-folders cannot be deleted.
/// </summary>
internal sealed class NotebookSyncHandler(AppDbContext db, ICurrentUser user, INotebookUsage usage) : ISyncHandler
{
    public string Entity => SyncEntities.Notebook;

    public async Task<IReadOnlyList<SyncChange>> PullAsync(long after, long before, int limit, CancellationToken ct)
    {
        // Deleted notebooks are gone from this table: they reach the devices as tombstones.
        var rows = await db.Notebooks.AsNoTracking()
            .Where(n => EF.Property<long>(n, "SyncSeq") > after && EF.Property<long>(n, "SyncSeq") < before)
            .OrderBy(n => EF.Property<long>(n, "SyncSeq"))
            .Take(limit)
            .Select(n => new { Dto = new NotebookDto(n.Id, n.Name, n.ParentId), Seq = EF.Property<long>(n, "SyncSeq") })
            .ToListAsync(ct);

        return rows.Select(r => new SyncChange(r.Seq, Entity, r.Dto.Id, Deleted: false, Data: r.Dto)).ToList();
    }

    public Task<long?> OldestSeqSinceAsync(DateTimeOffset since, CancellationToken ct) =>
        db.Notebooks
            .Where(n => EF.Property<DateTimeOffset>(n, "SyncAt") > since)
            .Select(n => (long?)EF.Property<long>(n, "SyncSeq"))
            .MinAsync(ct);

    public async Task<SyncOpResult> ApplyAsync(SyncOperation operation, DateTimeOffset now, CancellationToken ct)
    {
        var notebook = await db.Notebooks.FirstOrDefaultAsync(n => n.Id == operation.Id, ct);

        if (operation.Kind == SyncKinds.Delete)
        {
            return await DeleteAsync(notebook, ct);
        }

        string? name;
        bool hasParent;
        Guid? parentId;
        try
        {
            var patch = new SyncPatch(operation.Data);
            name = patch.GetString("name")?.Trim();
            hasParent = patch.Has("parentId");
            parentId = patch.GetGuid("parentId");
        }
        catch (FormatException ex)
        {
            return new SyncOpResult(SyncStatuses.Rejected, Error: ex.Message);
        }
        if (name is not null && (name.Length == 0 || name.Length > NotebookLimits.NameMaxLength))
        {
            return new SyncOpResult(SyncStatuses.Rejected, Error: $"The name must have 1 to {NotebookLimits.NameMaxLength} characters.");
        }

        // Every notebook of the user: needed to check that the parent exists and that the tree gets no loop.
        var parents = await db.Notebooks.AsNoTracking().ToDictionaryAsync(n => n.Id, n => n.ParentId, ct);

        if (notebook is null)
        {
            if (name is null)
            {
                return new SyncOpResult(SyncStatuses.Rejected, Error: "A new notebook needs a name.");
            }

            // A parent that was deleted meanwhile: the notebook goes to the top level instead of failing.
            var validParent = parentId is { } p && parents.ContainsKey(p) ? parentId : null;
            var created = Notebook.Create(user.RequiredUserId, name, validParent, now, operation.Id);
            db.Notebooks.Add(created);
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
            {
                db.ChangeTracker.Clear();
                return new SyncOpResult(SyncStatuses.Rejected, Error: "This id is already used by another notebook.");
            }

            return new SyncOpResult(SyncStatuses.Applied, NotebookDto.From(created));
        }

        var newParent = notebook.ParentId;
        if (hasParent)
        {
            // Moving it somewhere impossible (the parent is gone, or it would make a loop) is not applied:
            // the notebook stays where it is.
            var possible = parentId is null || (parents.ContainsKey(parentId.Value) && !NotebookTree.CreatesCycle(parents, notebook.Id, parentId.Value));
            if (possible)
            {
                newParent = parentId;
            }
        }

        notebook.Update(name ?? notebook.Name, newParent, now);
        await db.SaveChangesAsync(ct);
        return new SyncOpResult(SyncStatuses.Applied, NotebookDto.From(notebook));
    }

    private async Task<SyncOpResult> DeleteAsync(Notebook? notebook, CancellationToken ct)
    {
        if (notebook is null)
        {
            return new SyncOpResult(SyncStatuses.Applied); // already gone
        }

        // Another device may have put a note in this folder while this one was deleting it offline.
        if (await db.Notebooks.AnyAsync(n => n.ParentId == notebook.Id, ct) || await usage.HasNotesAsync(notebook.Id, ct))
        {
            return new SyncOpResult(
                SyncStatuses.Rejected,
                NotebookDto.From(notebook),
                "The notebook still contains notes or sub-notebooks, so it was not deleted.");
        }

        db.Notebooks.Remove(notebook);
        await db.SaveChangesAsync(ct);
        return new SyncOpResult(SyncStatuses.Applied);
    }
}
