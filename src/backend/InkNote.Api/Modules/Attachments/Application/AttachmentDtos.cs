using InkNote.Api.Modules.Attachments.Domain;

namespace InkNote.Api.Modules.Attachments.Application;

/// <summary>Settings under "Attachments".</summary>
public sealed class AttachmentOptions
{
    public const string SectionName = "Attachments";

    /// <summary>The largest single file. Checked while READING it, never from the declared length.</summary>
    public long MaxFileBytes { get; set; } = 10 * 1024 * 1024;

    /// <summary>The most one user may keep in total.</summary>
    public long MaxUserBytes { get; set; } = 200L * 1024 * 1024;

    /// <summary>How long a presigned download URL works. Short: it is a key that anybody holding it can use.</summary>
    public TimeSpan UrlLifetime { get; set; } = TimeSpan.FromMinutes(5);
}

public sealed record AttachmentDto(Guid Id, Guid NoteId, string FileName, string ContentType, long SizeBytes, bool IsImage, DateTimeOffset CreatedAt)
{
    public static AttachmentDto From(Attachment a) =>
        new(a.Id, a.NoteId, a.FileName, a.ContentType, a.SizeBytes, a.ContentType.StartsWith("image/", StringComparison.Ordinal), a.CreatedAt);
}

/// <summary>Where and until when the file can be downloaded (see IObjectStorage.CreateDownloadUrl).</summary>
public sealed record AttachmentUrlDto(string Url, DateTimeOffset ExpiresAt, string ContentType, string FileName, bool IsImage);

public enum UploadStatus { Created, AlreadyExists, NoteNotFound, Empty, TooLarge, QuotaExceeded, UnsupportedType }

public sealed record UploadResult(UploadStatus Status, AttachmentDto? Attachment = null);
