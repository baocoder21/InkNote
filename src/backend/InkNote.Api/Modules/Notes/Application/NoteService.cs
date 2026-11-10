using InkNote.Api.Common;
using InkNote.Api.Modules.Notebooks.Contracts;
using InkNote.Api.Modules.Notes.Contracts;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Contracts;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Modules.Notes.Application;

public enum UpdateNoteStatus { Updated, NotFound, Conflict, InvalidReference }

// ErrorField/ErrorMessage are set only for InvalidReference (e.g. a notebook id that does not exist).
public sealed record UpdateNoteResult(
    UpdateNoteStatus Status,
    NoteDto? Note = null,
    string? ErrorField = null,
    string? ErrorMessage = null);

// Note is null when a referenced notebook does not exist (then ErrorField/ErrorMessage are set).
public sealed record CreateNoteResult(NoteDto? Note, string? ErrorField = null, string? ErrorMessage = null);

/// <summary>
/// Use cases for notes. Endpoints stay thin and delegate here. Notebooks and tags belong to
/// other modules, so we only talk to them through their small contracts.
/// </summary>
public sealed class NoteService(
    AppDbContext db,
    ICurrentUser user,
    INotebookLookup notebooks,
    ITagLookup tags,
    TimeProvider clock)
{
    private const string NotebookNotFound = "The notebook does not exist.";
    private const string TagNotFound = "One or more tags do not exist.";

    /// <param name="notebookId">When set, only notes in this notebook.</param>
    /// <param name="tagId">When set, only notes that have this tag.</param>
    public async Task<IReadOnlyList<NoteSummaryDto>> ListAsync(Guid? notebookId, Guid? tagId, CancellationToken ct)
    {
        var query = db.Notes.AsNoTracking(); // read-only query: EF does not need to track changes

        if (notebookId is { } nb)
        {
            query = query.Where(n => n.NotebookId == nb);
        }

        if (tagId is { } tag)
        {
            // Becomes "WHERE EXISTS (SELECT 1 FROM note_tags WHERE note_id = n.id AND tag_id = @tag)".
            query = query.Where(n => n.Tags.Any(t => t.TagId == tag));
        }

        return await query
            .OrderByDescending(n => n.IsPinned) // pinned notes first...
            .ThenByDescending(n => n.UpdatedAt) // ...then most recently edited
            .Select(n => new NoteSummaryDto(
                n.Id, n.Title, n.UpdatedAt, n.Version, n.NotebookId, n.IsPinned, n.Status,
                n.Tags.Select(t => t.TagId).ToList()))
            .ToListAsync(ct);
    }

    public async Task<NoteDto?> GetAsync(Guid id, CancellationToken ct)
    {
        var note = await db.Notes.AsNoTracking().Include(n => n.Tags).FirstOrDefaultAsync(n => n.Id == id, ct);
        return note is null ? null : NoteDto.From(note);
    }

    public async Task<CreateNoteResult> CreateAsync(CreateNoteRequest request, CancellationToken ct)
    {
        if (request.NotebookId is { } nb && !await notebooks.ExistsAsync(nb, ct))
        {
            return new CreateNoteResult(null, "notebookId", NotebookNotFound);
        }

        var note = Note.Create(user.RequiredUserId, request.Title, request.Content, request.NotebookId, clock.GetUtcNow());
        db.Notes.Add(note);
        await db.SaveChangesAsync(ct);
        return new CreateNoteResult(NoteDto.From(note));
    }

    public async Task<UpdateNoteResult> UpdateAsync(Guid id, UpdateNoteRequest request, CancellationToken ct)
    {
        // Include(Tags): the response contains the tag ids, so they must be loaded.
        var note = await db.Notes.Include(n => n.Tags).FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return new UpdateNoteResult(UpdateNoteStatus.NotFound);
        }

        // Cheap early check: the client edited an outdated copy.
        if (note.Version != request.Version)
        {
            return new UpdateNoteResult(UpdateNoteStatus.Conflict);
        }

        note.Update(request.Title, request.Content, clock.GetUtcNow());

        if (!await TrySaveAsync(ct))
        {
            return new UpdateNoteResult(UpdateNoteStatus.Conflict);
        }

        return new UpdateNoteResult(UpdateNoteStatus.Updated, NoteDto.From(note));
    }

    public async Task<UpdateNoteResult> UpdateOrganizationAsync(
        Guid id, UpdateNoteOrganizationRequest request, CancellationToken ct)
    {
        var note = await db.Notes.Include(n => n.Tags).FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return new UpdateNoteResult(UpdateNoteStatus.NotFound);
        }

        if (note.Version != request.Version)
        {
            return new UpdateNoteResult(UpdateNoteStatus.Conflict);
        }

        // Check references through the other modules' contracts: a clear 400 beats a raw
        // foreign-key error from the database.
        if (request.NotebookId is { } nb && !await notebooks.ExistsAsync(nb, ct))
        {
            return new UpdateNoteResult(UpdateNoteStatus.InvalidReference, ErrorField: "notebookId", ErrorMessage: NotebookNotFound);
        }

        var tagIds = request.TagIds.Distinct().ToList(); // the same tag twice is not an error
        if (tagIds.Count > 0 && await tags.CountExistingAsync(tagIds, ct) != tagIds.Count)
        {
            return new UpdateNoteResult(UpdateNoteStatus.InvalidReference, ErrorField: "tagIds", ErrorMessage: TagNotFound);
        }

        note.SetOrganization(request.NotebookId, request.IsPinned, request.Status, tagIds);

        if (!await TrySaveAsync(ct))
        {
            return new UpdateNoteResult(UpdateNoteStatus.Conflict);
        }

        return new UpdateNoteResult(UpdateNoteStatus.Updated, NoteDto.From(note));
    }

    /// <returns>false when the note does not exist.</returns>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return false;
        }

        note.MarkDeleted(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return true;
    }

    /// <summary>The saved older texts of a note (newest first), or null when the note does not exist (a note in the trash counts).</summary>
    public async Task<IReadOnlyList<NoteRevisionDto>?> GetRevisionsAsync(Guid noteId, CancellationToken ct)
    {
        if (!await db.NotesIncludingDeleted.AnyAsync(n => n.Id == noteId, ct))
        {
            return null;
        }

        return await db.NoteRevisions.AsNoTracking()
            .Where(r => r.NoteId == noteId)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new NoteRevisionDto(r.Id, r.NoteId, r.Title, r.Content, r.NoteVersion, r.Reason, r.CreatedAt))
            .ToListAsync(ct);
    }

    // ---- Trash: notes that were deleted (soft) and can still be restored ----
    // The query filter hides deleted notes everywhere, so the trash uses db.TrashedNotes: the
    // current user's notes that ARE deleted (the owner check is written once, in AppDbContext, next
    // to the IgnoreQueryFilters that makes it necessary). None of these can touch a live note, nor
    // another user's.

    /// <summary>Deleted notes, most recently deleted first (UpdatedAt = the moment of deletion).</summary>
    public async Task<IReadOnlyList<NoteSummaryDto>> ListTrashAsync(CancellationToken ct) =>
        await db.TrashedNotes.AsNoTracking()
            .OrderByDescending(n => n.UpdatedAt)
            .Select(n => new NoteSummaryDto(
                n.Id, n.Title, n.UpdatedAt, n.Version, n.NotebookId, n.IsPinned, n.Status,
                n.Tags.Select(t => t.TagId).ToList()))
            .ToListAsync(ct);

    /// <summary>One deleted note with its content, so the user can look before restoring.</summary>
    public async Task<NoteDto?> GetTrashedAsync(Guid id, CancellationToken ct)
    {
        var note = await db.TrashedNotes.AsNoTracking().Include(n => n.Tags)
            .FirstOrDefaultAsync(n => n.Id == id, ct);
        return note is null ? null : NoteDto.From(note);
    }

    /// <returns>The restored note, or null when it is not in the trash.</returns>
    public async Task<NoteDto?> RestoreAsync(Guid id, CancellationToken ct)
    {
        var note = await db.TrashedNotes.Include(n => n.Tags)
            .FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return null;
        }

        // Its notebook may have been deleted while the note was in the trash: the foreign key
        // (ON DELETE SET NULL) already moved the note to "no notebook", so nothing to fix here.
        note.Restore(clock.GetUtcNow());
        if (!await TrySaveAsync(ct))
        {
            return null; // changed by someone else in the meantime; the caller sees "not found"
        }

        return NoteDto.From(note);
    }

    /// <summary>Deletes one note from the database for good. Only notes already in the trash.</summary>
    /// <returns>false when the note is not in the trash.</returns>
    public async Task<bool> PurgeAsync(Guid id, CancellationToken ct) =>
        // One DELETE statement; the database removes the note's note_tags rows (ON DELETE CASCADE).
        await db.TrashedNotes.Where(n => n.Id == id).ExecuteDeleteAsync(ct) > 0;

    /// <returns>How many notes were deleted for good.</returns>
    public async Task<int> EmptyTrashAsync(CancellationToken ct) =>
        await db.TrashedNotes.ExecuteDeleteAsync(ct);

    // Safety net for concurrent edits: Version is a concurrency token, so if another request
    // saved first, our UPDATE matched 0 rows and EF throws DbUpdateConcurrencyException.
    private async Task<bool> TrySaveAsync(CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            return false;
        }
    }
}

/// <summary>What the Notebooks module may ask: is anything stored in this notebook?</summary>
internal sealed class NotebookUsage(AppDbContext db) : INotebookUsage
{
    // The soft-delete filter on Notes applies here: deleted notes do not block deleting a notebook.
    public Task<bool> HasNotesAsync(Guid notebookId, CancellationToken ct) =>
        db.Notes.AnyAsync(n => n.NotebookId == notebookId, ct);
}
