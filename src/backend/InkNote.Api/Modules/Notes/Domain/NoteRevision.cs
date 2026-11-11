namespace InkNote.Api.Modules.Notes.Domain;

/// <summary>
/// An older text of a note, kept so that nothing is lost. Created when two devices changed the same note (reason
/// "conflict"), before an edit ("edit", throttled: see NoteRevisionRecorder) and before a restore ("restore").
/// The history screen lists them and puts one back.
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

    /// <summary>Two devices changed the note: the text that lost is kept here.</summary>
    public const string ConflictReason = "conflict";

    /// <summary>The text as it was before an edit (at most one per editing session).</summary>
    public const string EditReason = "edit";

    /// <summary>The text as it was before an older version was put back, so that a restore can be undone too.</summary>
    public const string RestoreReason = "restore";

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
