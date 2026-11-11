namespace InkNote.Api.Modules.Notes.Contracts;

/// <summary>The only thing other modules may ask the Notes module about a single note.</summary>
public interface INoteLookup
{
    /// <summary>
    /// True when the current user owns a note with this id: in their notes OR in their trash (a note in the trash
    /// can be restored, so files may still be attached to it). Another user's note simply "does not exist".
    /// </summary>
    Task<bool> ExistsAsync(Guid noteId, CancellationToken ct);
}
