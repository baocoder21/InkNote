using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Amazon.S3.Util;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Common.Storage;

/// <summary>
/// <see cref="IObjectStorage"/> over the S3 API (AWS S3, Cloudflare R2, MinIO: the same calls, other settings).
/// </summary>
public sealed class S3ObjectStorage(IOptions<StorageOptions> options) : IObjectStorage, IDisposable
{
    private readonly Lazy<AmazonS3Client> client = new(() => Create(options.Value, options.Value.ServiceUrl));

    // Signing a URL is a local calculation (no network): a second client only to put the PUBLIC address in it.
    private readonly Lazy<AmazonS3Client> signer = new(() =>
    {
        var o = options.Value;
        return Create(o, string.IsNullOrWhiteSpace(o.PublicUrl) ? o.ServiceUrl : o.PublicUrl);
    });

    private static AmazonS3Client Create(StorageOptions o, string serviceUrl)
    {
        var config = new AmazonS3Config
        {
            ForcePathStyle = o.ForcePathStyle,
            AuthenticationRegion = o.Region,
            // Newer SDKs add a checksum header to every request by default. R2 and older MinIO builds do not understand
            // it and answer with an error: ask for checksums only where the S3 API requires them.
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
            ResponseChecksumValidation = ResponseChecksumValidation.WHEN_REQUIRED,
        };
        if (!string.IsNullOrWhiteSpace(serviceUrl))
        {
            config.ServiceURL = serviceUrl;
        }
        else
        {
            config.RegionEndpoint = RegionEndpoint.GetBySystemName(o.Region);
        }

        return new AmazonS3Client(new BasicAWSCredentials(o.AccessKey, o.SecretKey), config);
    }

    public async Task PutAsync(string key, Stream content, string contentType, CancellationToken ct)
    {
        await client.Value.PutObjectAsync(new PutObjectRequest
        {
            BucketName = options.Value.Bucket,
            Key = key,
            InputStream = content,
            ContentType = contentType,
            AutoCloseStream = false,
        }, ct);
    }

    public async Task DeleteAsync(IReadOnlyCollection<string> keys, CancellationToken ct)
    {
        // The S3 API deletes at most 1000 objects per call.
        foreach (var batch in keys.Chunk(1000))
        {
            await client.Value.DeleteObjectsAsync(new DeleteObjectsRequest
            {
                BucketName = options.Value.Bucket,
                Objects = batch.Select(k => new KeyVersion { Key = k }).ToList(),
                Quiet = true,
            }, ct);
        }
    }

    public string CreateDownloadUrl(string key, TimeSpan lifetime, string contentType, string contentDisposition)
    {
        var o = options.Value;
        var endpoint = string.IsNullOrWhiteSpace(o.PublicUrl) ? o.ServiceUrl : o.PublicUrl;
        return signer.Value.GetPreSignedURL(new GetPreSignedUrlRequest
        {
            BucketName = o.Bucket,
            Key = key,
            Verb = HttpVerb.GET,
            Expires = DateTime.UtcNow.Add(lifetime),
            // The SDK signs https:// URLs unless told otherwise, whatever the endpoint is. MinIO in development is plain
            // http, and a browser cannot load an https:// address from it.
            Protocol = Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttp ? Protocol.HTTP : Protocol.HTTPS,
            ResponseHeaderOverrides = new ResponseHeaderOverrides
            {
                ContentType = contentType,
                ContentDisposition = contentDisposition,
            },
        });
    }

    /// <summary>Creates the bucket when it does not exist (development).</summary>
    public async Task EnsureBucketAsync(CancellationToken ct)
    {
        if (!await AmazonS3Util.DoesS3BucketExistV2Async(client.Value, options.Value.Bucket))
        {
            await client.Value.PutBucketAsync(options.Value.Bucket, ct);
        }
    }

    public void Dispose()
    {
        if (client.IsValueCreated) client.Value.Dispose();
        if (signer.IsValueCreated) signer.Value.Dispose();
    }
}
