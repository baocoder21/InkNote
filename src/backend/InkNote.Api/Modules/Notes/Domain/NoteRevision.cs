namespace InkNote.Api.Modules.Notes.Domain;

/// <summary>
/// An older text of a note, kept so that nothing is lost. For now they are created when two devices
/// changed the same note and one change had to overwrite the other (reason "conflict"): the text that was
/// overwritten is saved here. Phase 11 adds a screen to browse and restore them.
/// </summary>
public sealed class NoteRevision
{
    private NoteRevision() { }

    public Guid Id { get; private set; }
    public Guid? UserId { get; private set; }
    public Guid NoteId { get; private set; }
    public string Title { get; private set; } = string.Empty;
    public string Content { get; private set; } = string.Empty;

    /// <summary>The Version the note had when this text was current.</summary>
    public int NoteVersion { get; private set; }
    public string Reason { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }

    public const string ConflictReason = "conflict";

    public static NoteRevision Create(Guid userId, Note note, string reason, DateTimeOffset now) => new()
    {
        Id = Guid.CreateVersion7(),
        UserId = userId,
        NoteId = note.Id,
        Title = note.Title,
        Content = note.Content,
        NoteVersion = note.Version,
        Reason = reason,
        CreatedAt = now,
    };
}
