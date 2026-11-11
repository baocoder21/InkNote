using Microsoft.Extensions.Options;

namespace InkNote.Api.Common.Storage;

/// <summary>
/// Creates the bucket at start-up when <c>Storage:CreateBucketIfMissing</c> is on (development and integration
/// tests). A failure is logged, not fatal: the rest of the application works without attachments.
/// </summary>
public sealed class StorageBucketInitializer(
    IObjectStorage storage,
    IOptions<StorageOptions> options,
    ILogger<StorageBucketInitializer> logger) : IHostedService
{
    public async Task StartAsync(CancellationToken ct)
    {
        if (!options.Value.CreateBucketIfMissing || storage is not S3ObjectStorage s3)
        {
            return;
        }

        try
        {
            await s3.EnsureBucketAsync(ct);
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Could not check or create the storage bucket '{Bucket}'. Attachments will fail until the storage is reachable.", options.Value.Bucket);
        }
    }

    public Task StopAsync(CancellationToken ct) => Task.CompletedTask;
}
