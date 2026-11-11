namespace InkNote.Api.Common.Storage;

/// <summary>Settings under "Storage". The keys are secrets: user-secrets / environment variables, never the repository.</summary>
public sealed class StorageOptions
{
    public const string SectionName = "Storage";

    /// <summary>The S3 endpoint the SERVER talks to (development: http://localhost:9000). Empty for AWS S3 itself.</summary>
    public string ServiceUrl { get; set; } = string.Empty;

    /// <summary>
    /// The endpoint the BROWSER must use in presigned URLs, when it differs from <see cref="ServiceUrl"/> (for example
    /// the server reaches the storage as http://storage:9000 inside Docker, the browser as http://localhost:9000).
    /// Empty = same as ServiceUrl.
    /// </summary>
    public string PublicUrl { get; set; } = string.Empty;

    public string AccessKey { get; set; } = string.Empty;
    public string SecretKey { get; set; } = string.Empty;
    public string Bucket { get; set; } = "inknote-attachments";

    /// <summary>The region used to sign requests. Cloudflare R2 wants "auto"; MinIO accepts anything.</summary>
    public string Region { get; set; } = "us-east-1";

    /// <summary>true = http://host/bucket/key (MinIO, R2); false = http://bucket.host/key (AWS S3).</summary>
    public bool ForcePathStyle { get; set; } = true;

    /// <summary>Development convenience: create the bucket at start-up when it is missing. Production buckets are provisioned.</summary>
    public bool CreateBucketIfMissing { get; set; }
}
