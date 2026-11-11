namespace InkNote.Api.Modules.Attachments.Contracts;

/// <summary>What the Notes module calls when notes are deleted for good: their attached files go too.</summary>
public interface IAttachmentCleanup
{
    /// <summary>
    /// Deletes the attachment records of these notes (of the current user) and then their files from the storage.
    /// A file that cannot be removed from the storage is logged and left behind: it must never stop a note from
    /// being deleted.
    /// </summary>
    Task DeleteOfNotesAsync(IReadOnlyCollection<Guid> noteIds, CancellationToken ct);
}
