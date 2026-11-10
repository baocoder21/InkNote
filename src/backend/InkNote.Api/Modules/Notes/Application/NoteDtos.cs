using InkNote.Api.Modules.Notes.Domain;

namespace InkNote.Api.Modules.Notes.Application;

// DTOs = the shape of data going in/out of the API. They are separate from the
// entity so clients can only send/see the fields we choose.

public sealed record CreateNoteRequest(string Title, string Content);

// Version = the version the client last saw. If it no longer matches, someone else
// changed the note in the meantime and we answer 409 Conflict.
public sealed record UpdateNoteRequest(string Title, string Content, int Version);

public sealed record NoteDto(
    Guid Id,
    string Title,
    string Content,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int Version)
{
    public static NoteDto From(Note note) => new(
        note.Id, note.Title, note.Content, note.CreatedAt, note.UpdatedAt, note.Version);
}

// The list does not need the (possibly large) content.
public sealed record NoteSummaryDto(Guid Id, string Title, DateTimeOffset UpdatedAt, int Version);
