using System.Globalization;
using System.Text;
using InkNote.Api.Common;
using InkNote.Api.Common.Storage;
using InkNote.Api.Modules.Attachments.Contracts;
using InkNote.Api.Modules.Attachments.Domain;
using InkNote.Api.Modules.Attachments.Infrastructure;
using InkNote.Api.Modules.Notes.Contracts;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Attachments.Application;

/// <summary>
/// Use cases for attachments. The checks come in the order of their cost: who owns what (a query), then the file
/// itself (read with a cap, never trusting the declared size or type), then the quota; only then does anything
/// reach the storage.
/// </summary>
public sealed class AttachmentService(
    AppDbContext db,
    ICurrentUser user,
    INoteLookup notes,
    IObjectStorage storage,
    IOptions<AttachmentOptions> options,
    TimeProvider clock,
    ILogger<AttachmentService> logger) : IAttachmentCleanup
{
    public async Task<UploadResult> UploadAsync(Guid id, Guid noteId, string fileName, Stream content, CancellationToken ct)
    {
        var userId = user.RequiredUserId;
        var limits = options.Value;

        // The same upload sent again (the first answer was lost): the file is already there, nothing to do.
        if (await db.Attachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct) is { } existing)
        {
            return new(UploadStatus.AlreadyExists, AttachmentDto.From(existing));
        }

        if (!await notes.ExistsAsync(noteId, ct))
        {
            return new(UploadStatus.NoteNotFound);
        }

        var bytes = await ReadAtMostAsync(content, limits.MaxFileBytes, ct);
        if (bytes is null)
        {
            return new(UploadStatus.TooLarge);
        }

        if (bytes.Length == 0)
        {
            return new(UploadStatus.Empty);
        }

        var cleanName = CleanFileName(fileName);
        if (FileSniffer.Detect(bytes, cleanName) is not { } detected)
        {
            return new(UploadStatus.UnsupportedType);
        }

        var used = await db.Attachments.SumAsync(a => a.SizeBytes, ct);
        if (used + bytes.Length > limits.MaxUserBytes)
        {
            return new(UploadStatus.QuotaExceeded);
        }

        var attachment = Attachment.Create(id, userId, noteId, cleanName, detected.ContentType, bytes.Length, clock.GetUtcNow());

        using (var stream = new MemoryStream(bytes, writable: false))
        {
            await storage.PutAsync(attachment.StorageKey, stream, detected.ContentType, ct);
        }

        db.Attachments.Add(attachment);
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException)
        {
            // Two uploads of the same id at once: the other one won. The object has the same key, so it stays.
            db.Entry(attachment).State = EntityState.Detached;
            if (await db.Attachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct) is { } winner)
            {
                return new(UploadStatus.AlreadyExists, AttachmentDto.From(winner));
            }

            throw;
        }

        return new(UploadStatus.Created, AttachmentDto.From(attachment));
    }

    /// <returns>null when the file does not exist or is not the current user's.</returns>
    public async Task<AttachmentDto?> GetAsync(Guid id, CancellationToken ct) =>
        await db.Attachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct) is { } found ? AttachmentDto.From(found) : null;

    /// <param name="download">true = the browser must save the file instead of showing it (images are shown by default).</param>
    /// <returns>null when the file does not exist or is not the current user's: no URL is ever made for it.</returns>
    public async Task<AttachmentUrlDto?> CreateUrlAsync(Guid id, bool download, CancellationToken ct)
    {
        if (await db.Attachments.AsNoTracking().FirstOrDefaultAsync(a => a.Id == id, ct) is not { } attachment)
        {
            return null;
        }

        var lifetime = options.Value.UrlLifetime;
        var isImage = attachment.ContentType.StartsWith("image/", StringComparison.Ordinal);
        // Only images may be shown inside a page. Everything else is a download, whatever the caller asked for.
        var disposition = isImage && !download ? "inline" : AttachmentDisposition(attachment.FileName);
        var url = storage.CreateDownloadUrl(attachment.StorageKey, lifetime, attachment.ContentType, disposition);
        return new(url, clock.GetUtcNow().Add(lifetime), attachment.ContentType, attachment.FileName, isImage);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        if (await db.Attachments.FirstOrDefaultAsync(a => a.Id == id, ct) is not { } attachment)
        {
            return false;
        }

        db.Attachments.Remove(attachment);
        await db.SaveChangesAsync(ct);
        await TryDeleteObjectsAsync([attachment.StorageKey], ct);
        return true;
    }

    public async Task DeleteOfNotesAsync(IReadOnlyCollection<Guid> noteIds, CancellationToken ct)
    {
        if (noteIds.Count == 0)
        {
            return;
        }

        // The query filter limits this to the current user's files.
        var keys = await db.Attachments.Where(a => noteIds.Contains(a.NoteId)).Select(a => a.StorageKey).ToListAsync(ct);
        if (keys.Count == 0)
        {
            return;
        }

        await db.Attachments.Where(a => noteIds.Contains(a.NoteId)).ExecuteDeleteAsync(ct);
        await TryDeleteObjectsAsync(keys, ct);
    }

    private async Task TryDeleteObjectsAsync(IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        try
        {
            await storage.DeleteAsync(keys, ct);
        }
        catch (Exception ex)
        {
            // The record is gone already. A file left in the storage costs space, but must not turn a delete into an error.
            logger.LogWarning(ex, "Could not delete {Count} file(s) from the storage; they are left behind.", keys.Count);
        }
    }

    /// <returns>null when the stream holds more than <paramref name="max"/> bytes (it stops reading right there).</returns>
    private static async Task<byte[]?> ReadAtMostAsync(Stream stream, long max, CancellationToken ct)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await stream.ReadAsync(chunk, ct)) > 0)
        {
            if (buffer.Length + read > max)
            {
                return null;
            }

            buffer.Write(chunk, 0, read);
        }

        return buffer.ToArray();
    }

    /// <summary>
    /// The name is only for display and download: no folders (a path in a name), no control characters (a line break
    /// in a header), no invisible direction-changing characters (they can make "photo‮gnp.exe" look like "photoexe.png").
    /// </summary>
    public static string CleanFileName(string? name)
    {
        var text = name ?? string.Empty;
        text = text[(text.LastIndexOfAny(['/', '\\']) + 1)..];

        var clean = new StringBuilder(text.Length);
        foreach (var ch in text)
        {
            var category = char.GetUnicodeCategory(ch);
            if (category is UnicodeCategory.Control or UnicodeCategory.Format or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator)
            {
                continue;
            }

            clean.Append(ch);
        }

        var result = clean.ToString().Trim().TrimStart('.');
        if (result.Length > AttachmentConfiguration.FileNameMaxLength)
        {
            // Keep the extension: it tells the user (and the text-file check) what the file is.
            var extension = Path.GetExtension(result);
            extension = extension.Length > 16 ? string.Empty : extension;
            result = result[..(AttachmentConfiguration.FileNameMaxLength - extension.Length)] + extension;
        }

        return result.Length == 0 ? "file" : result;
    }

    /// <summary>"attachment; filename=...": the browser saves the file. Plain ASCII name for old clients, the real one encoded (RFC 5987).</summary>
    public static string AttachmentDisposition(string fileName)
    {
        var ascii = new string(fileName.Select(c => c is >= ' ' and < '\u007f' and not '"' and not '\\' ? c : '_').ToArray());
        return $"attachment; filename=\"{ascii}\"; filename*=UTF-8''{Uri.EscapeDataString(fileName)}";
    }
}
