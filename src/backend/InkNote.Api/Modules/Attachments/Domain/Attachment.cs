namespace InkNote.Api.Modules.Attachments.Domain;

/// <summary>
/// The record of a file attached to a note. The BYTES are not here: they live in the object storage under
/// <see cref="StorageKey"/>. The id is chosen by the client (like a note's), so an upload can be started offline
/// and repeated safely.
/// </summary>
public sealed class Attachment
{
    private Attachment() { } // for EF Core

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public Guid NoteId { get; private set; }

    /// <summary>The name the user's file had, cleaned (no path, no control characters). Only for display and download.</summary>
    public string FileName { get; private set; } = string.Empty;

    /// <summary>The type DETECTED from the bytes by the server, never the one the client declared.</summary>
    public string ContentType { get; private set; } = string.Empty;

    public long SizeBytes { get; private set; }

    /// <summary>Where the bytes are in the object storage. Built by the server from ids only, never from a file name.</summary>
    public string StorageKey { get; private set; } = string.Empty;

    public DateTimeOffset CreatedAt { get; private set; }

    public static Attachment Create(Guid id, Guid userId, Guid noteId, string fileName, string contentType, long sizeBytes, DateTimeOffset now) =>
        new()
        {
            Id = id,
            UserId = userId,
            NoteId = noteId,
            FileName = fileName,
            ContentType = contentType,
            SizeBytes = sizeBytes,
            StorageKey = KeyFor(userId, id),
            CreatedAt = now,
        };

    /// <summary>"user/attachment": no file name in it, so nothing a user types can steer where a file goes.</summary>
    public static string KeyFor(Guid userId, Guid id) => $"{userId:N}/{id:N}";
}
