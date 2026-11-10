namespace InkNote.Api.Modules.Notes.Domain;

/// <summary>
/// Join row of the many-to-many relation between notes and tags: one row = "this note has
/// this tag". It belongs to the Notes module (tags are part of a note's data); the Tag
/// itself lives in the Tags module and is only referenced by its Id.
/// </summary>
public sealed class NoteTag
{
    private NoteTag() { }

    public NoteTag(Guid noteId, Guid tagId)
    {
        NoteId = noteId;
        TagId = tagId;
    }

    public Guid NoteId { get; private set; }
    public Guid TagId { get; private set; }
}
