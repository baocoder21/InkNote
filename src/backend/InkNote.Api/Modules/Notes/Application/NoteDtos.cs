using InkNote.Api.Modules.Notes.Domain;

namespace InkNote.Api.Modules.Notes.Application;

// DTOs = the shape of data going in/out of the API. They are separate from the
// entity so clients can only send/see the fields we choose.

// NotebookId is optional: creating a note while a notebook is selected files it there.
public sealed record CreateNoteRequest(string Title, string Content, Guid? NotebookId = null);

// Version = the version the client last saw. If it no longer matches, someone else
// changed the note in the meantime and we answer 409 Conflict.
public sealed record UpdateNoteRequest(string Title, string Content, int Version);

// Changes where the note lives and how it is labelled. Separate from UpdateNoteRequest so
// the editor's autosave never has to send (and risk overwriting) these fields.
// TagIds is the complete set of tags the note should have afterwards.
public sealed record UpdateNoteOrganizationRequest(
    Guid? NotebookId,
    bool IsPinned,
    NoteStatus Status,
    IReadOnlyList<Guid> TagIds,
    int Version);

public sealed record NoteDto(
    Guid Id,
    string Title,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int Version,
    Guid? NotebookId,
    bool IsPinned,
    NoteStatus Status,
    IReadOnlyList<Guid> TagIds)
{
    public static NoteDto From(Note note) => new(
        note.Id, note.Title, note.Content, note.CreatedAt, note.UpdatedAt, note.Version,
        note.NotebookId, note.IsPinned, note.Status, note.Tags.Select(t => t.TagId).ToList());
}

// The list does not need the (possibly large) content.
public sealed record NoteSummaryDto(
    Guid Id,
    string Title,
    DateTimeOffset UpdatedAt,
    int Version,
    Guid? NotebookId,
    bool IsPinned,
    NoteStatus Status,
    IReadOnlyList<Guid> TagIds);

// Answer of "empty the trash": how many notes were removed from the database.
public sealed record EmptyTrashResult(int Deleted);
