using System.Collections.Concurrent;
using InkNote.Api.Common.Storage;

namespace InkNote.Api.Tests;

/// <summary>An object storage in memory, for tests that are not about S3 itself. Remembers what it was asked.</summary>
public sealed class FakeObjectStorage : IObjectStorage
{
    public sealed record Stored(byte[] Bytes, string ContentType);
    public sealed record SignedUrl(string Key, TimeSpan Lifetime, string ContentType, string ContentDisposition, string Url);

    private readonly ConcurrentDictionary<string, Stored> objects = new();
    private int puts;

    public IReadOnlyDictionary<string, Stored> Objects => objects;
    public int PutCount => Volatile.Read(ref puts);

    /// <summary>Every presigned URL that was made, in order.</summary>
    public ConcurrentQueue<SignedUrl> Urls { get; } = new();

    /// <summary>When set, deleting fails with this (to see that a failing storage does not break deleting notes).</summary>
    public Exception? DeleteFailure { get; set; }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        using var copy = new MemoryStream();
        await content.CopyToAsync(copy, ct);
        objects[key] = new Stored(copy.ToArray(), contentType);
        Interlocked.Increment(ref puts);
    }

    public Task DeleteAsync(IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        if (DeleteFailure is { } failure)
        {
            throw failure;
        }

        foreach (var key in keys)
        {
            objects.TryRemove(key, out _);
        }

        return Task.CompletedTask;
    }

    public string CreateDownloadUrl(string key, TimeSpan lifetime, string contentType, string contentDisposition)
    {
        var url = $"https://storage.test/{key}?signature=fake";
        Urls.Enqueue(new SignedUrl(key, lifetime, contentType, contentDisposition, url));
        return url;
    }
}
