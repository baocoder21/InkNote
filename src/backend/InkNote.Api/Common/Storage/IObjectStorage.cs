namespace InkNote.Api.Common.Storage;

/// <summary>
/// Where files live: an object storage (S3, Cloudflare R2, MinIO in development), NOT the database. The application
/// only needs these three things, so the rest of the code does not know which service is behind them, and tests
/// can replace it with a fake.
/// </summary>
public interface IObjectStorage
{
    /// <summary>Stores (or replaces) the object under <paramref name="key"/>.</summary>
    Task PutAsync(string key, Stream content, string contentType, CancellationToken ct);

    /// <summary>Deletes objects. A key that does not exist is not an error.</summary>
    Task DeleteAsync(IReadOnlyCollection<string> keys, CancellationToken ct);

    /// <summary>
    /// A presigned URL: an address that lets WHOEVER HOLDS IT download this one object until it expires, without
    /// signing in. The signature in the address proves that our server allowed it. The server asks for one only after it
    /// checked that the signed-in user owns the file. The storage is told to answer with this content type and this
    /// Content-Disposition (inline = shown in the page, attachment = downloaded), whatever else is stored.
    /// </summary>
    string CreateDownloadUrl(string key, TimeSpan lifetime, string contentType, string contentDisposition);
}
