using System.Text.Unicode;

namespace InkNote.Api.Modules.Attachments.Application;

/// <summary>What the server found a file to be by looking at its BYTES.</summary>
/// <param name="ContentType">The type the file will be served as.</param>
/// <param name="IsImage">Images may be shown inside the page; everything else is only ever downloaded.</param>
public sealed record DetectedFile(string ContentType, bool IsImage);

/// <summary>
/// Decides what a file really is. The name and the Content-Type come from the client and can say anything (a script
/// called "photo.png"); the first bytes of a real PNG, JPEG, GIF, WebP or PDF are fixed ("magic bytes"). Only these
/// types are accepted. Everything else is refused, on purpose: SVG and HTML can carry scripts, archives and
/// programs are not what a note needs.
/// </summary>
public static class FileSniffer
{
    /// <summary>Plain text is accepted only with one of these extensions (it has no magic bytes to check).</summary>
    private static readonly HashSet<string> TextExtensions = new(StringComparer.OrdinalIgnoreCase) { ".txt", ".md", ".csv", ".log", ".json" };

    // Written as bytes: a "..."u8 literal is UTF-8 text, where the byte 0x89 would become TWO bytes (C2 89).
    private static ReadOnlySpan<byte> PngSignature => [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    public static DetectedFile? Detect(ReadOnlySpan<byte> data, string fileName)
    {
        if (data.IsEmpty)
        {
            return null;
        }

        if (data.StartsWith(PngSignature))
        {
            return new("image/png", true);
        }

        if (data.StartsWith(new byte[] { 0xFF, 0xD8, 0xFF }))
        {
            return new("image/jpeg", true);
        }

        if (data.StartsWith("GIF87a"u8) || data.StartsWith("GIF89a"u8))
        {
            return new("image/gif", true);
        }

        // WebP is a RIFF container: "RIFF", 4 bytes of length, "WEBP".
        if (data.Length >= 12 && data[..4].SequenceEqual("RIFF"u8) && data.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return new("image/webp", true);
        }

        if (data.StartsWith("%PDF-"u8))
        {
            return new("application/pdf", false);
        }

        // Text: a known extension, valid UTF-8, and no NUL byte (a sure sign of a binary file).
        if (TextExtensions.Contains(Path.GetExtension(fileName)) && Utf8.IsValid(data) && !data.Contains((byte)0))
        {
            return new("text/plain", false);
        }

        return null;
    }
}
