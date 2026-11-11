using InkNote.Api.Common;
using InkNote.Api.Modules.Notebooks.Contracts;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Modules.Tags.Contracts;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace InkNote.Api.Modules.Notes.Application;

/// <summary>
/// Synchronization of notes. See ISyncHandler. The rules for an operation on a note:
///  - the data is a PATCH: only the fields that changed. Fields the device did not touch keep the server's value,
///    so two devices changing different fields of one note both win;
///  - BaseVersion != the note's Version means the server moved on since the device last looked. If the patch
///    then replaces the title or content with something different, the text that is about to be overwritten is
///    saved as a NoteRevision first (nothing is ever lost) and the answer is "conflict": the device's change
///    wins (last write wins) and it tells the user;
///  - a note deleted elsewhere stays deleted: an edit that arrives is applied to the copy in the trash and the
///    answer is "gone" (the device drops its copy; the text can be restored from the trash).
/// </summary>
internal sealed class NoteSyncHandler(
    AppDbContext db,
    ICurrentUser user,
    INotebookLookup notebooks,
    ITagLookup tags,
    NoteRevisionRecorder revisions) : ISyncHandler
{
    public string Entity => SyncEntities.Note;

    public async Task<IReadOnlyList<SyncChange>> PullAsync(long after, long before, int limit, CancellationToken ct)
    {
        var rows = await db.NotesIncludingDeleted.AsNoTracking()
            .Where(n => EF.Property<long>(n, "SyncSeq") > after && EF.Property<long>(n, "SyncSeq") < before)
            .OrderBy(n => EF.Property<long>(n, "SyncSeq"))
            .Take(limit)
            .Select(n => new
            {
                n.Id, n.Title, n.Content, n.CreatedAt, n.UpdatedAt, n.Version,
                n.NotebookId, n.IsPinned, n.Status, n.IsDeleted,
                TagIds = n.Tags.Select(t => t.TagId).ToList(),
                Seq = EF.Property<long>(n, "SyncSeq"),
            })
            .ToListAsync(ct);

        // A deleted note is reported as a deletion (no data): the other devices drop it.
        return rows.Select(r => r.IsDeleted
            ? new SyncChange(r.Seq, Entity, r.Id, Deleted: true, Data: null)
            : new SyncChange(r.Seq, Entity, r.Id, Deleted: false, Data: new NoteDto(
                r.Id, r.Title, r.Content, r.CreatedAt, r.UpdatedAt, r.Version, r.NotebookId, r.IsPinned, r.Status, r.TagIds)))
            .ToList();
    }

    public Task<long?> OldestSeqSinceAsync(DateTimeOffset since, CancellationToken ct) =>
        db.NotesIncludingDeleted
            .Where(n => EF.Property<DateTimeOffset>(n, "SyncAt") > since)
            .Select(n => (long?)EF.Property<long>(n, "SyncSeq"))
            .MinAsync(ct);

    public async Task<SyncOpResult> ApplyAsync(SyncOperation operation, DateTimeOffset now, CancellationToken ct)
    {
        if (operation.Kind == SyncKinds.Delete)
        {
            var toDelete = await db.Notes.FirstOrDefaultAsync(n => n.Id == operation.Id, ct);
            if (toDelete is null)
            {
                return Applied(); // already deleted or never existed: the wish is already true
            }

            toDelete.MarkDeleted(now); // soft delete, as with the REST API: it lands in the trash
            await db.SaveChangesAsync(ct);
            return Applied();
        }

        NotePatch patch;
        try
        {
            patch = NotePatch.Read(operation.Data);
        }
        catch (FormatException ex)
        {
            return Rejected(ex.Message);
        }
        if (patch.Validate() is { } problem)
        {
            return Rejected(problem);
        }

        var note = await db.Notes.Include(n => n.Tags).FirstOrDefaultAsync(n => n.Id == operation.Id, ct);
        if (note is null)
        {
            return await ApplyToMissingNoteAsync(operation, patch, now, ct);
        }

        // The server moved on since the device last looked?
        var staleBase = operation.BaseVersion is { } baseVersion && baseVersion != note.Version;
        var overwritesText = (patch.Title is not null && patch.Title != note.Title)
                             || (patch.Content is not null && patch.Content != note.Content);
        var conflict = staleBase && overwritesText;
        if (conflict)
        {
            db.NoteRevisions.Add(NoteRevision.Create(user.RequiredUserId, note, NoteRevision.ConflictReason, now));
        }

        await ApplyPatchAsync(note, patch, now, ct);
        await db.SaveChangesAsync(ct);
        return new SyncOpResult(conflict ? SyncStatuses.Conflict : SyncStatuses.Applied, NoteDto.From(note));
    }

    // Not among the live notes: in the trash, never existed, or being created now.
    private async Task<SyncOpResult> ApplyToMissingNoteAsync(SyncOperation operation, NotePatch patch, DateTimeOffset now, CancellationToken ct)
    {
        var trashed = await db.TrashedNotes.Include(n => n.Tags).FirstOrDefaultAsync(n => n.Id == operation.Id, ct);
        if (trashed is not null)
        {
            // Deleted elsewhere. It stays deleted, but the text typed on this device is not thrown away:
            // it goes into the copy in the trash.
            await ApplyPatchAsync(trashed, patch, now, ct);
            await db.SaveChangesAsync(ct);
            return new SyncOpResult(SyncStatuses.Gone);
        }

        if (operation.BaseVersion is not null)
        {
            // The device edited a note it knew, and the note is gone for good (deleted forever elsewhere).
            return new SyncOpResult(SyncStatuses.Gone);
        }

        // A new note, with the id the device gave it.
        if (patch.Title is null)
        {
            return Rejected("A new note needs a title.");
        }

        var created = Note.Create(user.RequiredUserId, patch.Title, patch.Content ?? string.Empty, notebookId: null, now, operation.Id);
        await ApplyPatchAsync(created, patch with { Title = null, Content = null }, now, ct); // org fields; text is already set
        db.Notes.Add(created);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            db.ChangeTracker.Clear();
            return Rejected("This id is already used by another note.");
        }

        return Applied(NoteDto.From(created));
    }

    // Resolves what the patch refers to, then applies it. A notebook or tag that another device deleted in the
    // meantime is simply left out (the note ends up with no notebook / without that tag) instead of failing.
    private async Task ApplyPatchAsync(Note note, NotePatch patch, DateTimeOffset now, CancellationToken ct)
    {
        Guid? notebookId = null;
        if (patch.HasNotebook && patch.NotebookId is { } wanted && await notebooks.ExistsAsync(wanted, ct))
        {
            notebookId = wanted;
        }

        IReadOnlyCollection<Guid>? tagIds = null;
        if (patch.TagIds is { } wantedTags)
        {
            tagIds = wantedTags.Count == 0 ? [] : await tags.FilterExistingAsync(wantedTags, ct);
        }

        await revisions.RecordBeforeEditAsync(note, patch.Title, patch.Content, now, ct); // the text as it was
        note.ApplyPatch(patch.Title, patch.Content, patch.HasNotebook, notebookId, patch.IsPinned, patch.Status, tagIds, now);
    }

    private static SyncOpResult Applied(object? entity = null) => new(SyncStatuses.Applied, entity);

    private static SyncOpResult Rejected(string error) => new(SyncStatuses.Rejected, Error: error);
}

/// <summary>The fields of a note a device may change. null = not mentioned = leave as it is.</summary>
internal sealed record NotePatch(
    string? Title,
    string? Content,
    bool HasNotebook,
    Guid? NotebookId,
    bool? IsPinned,
    NoteStatus? Status,
    IReadOnlyList<Guid>? TagIds)
{
    public static NotePatch Read(System.Text.Json.JsonElement? data)
    {
        var reader = new SyncPatch(data);
        return new NotePatch(
            reader.GetString("title"),
            reader.GetString("content"),
            reader.Has("notebookId"),
            reader.GetGuid("notebookId"),
            reader.GetBool("isPinned"),
            reader.GetEnum<NoteStatus>("status"),
            reader.GetGuidList("tagIds"));
    }

    /// <returns>What is wrong with the patch, or null.</returns>
    public string? Validate()
    {
        if (Title is not null && (Title.Trim().Length == 0 || Title.Length > NoteLimits.TitleMaxLength))
        {
            return $"The title must have 1 to {NoteLimits.TitleMaxLength} characters.";
        }
        if (Content is not null && Content.Length > NoteLimits.ContentMaxLength)
        {
            return $"The content is longer than {NoteLimits.ContentMaxLength} characters.";
        }
        if (TagIds is not null && TagIds.Count > NoteOrganizationLimits.MaxTagsPerNote)
        {
            return $"A note can have at most {NoteOrganizationLimits.MaxTagsPerNote} tags.";
        }

        return null;
    }
}
