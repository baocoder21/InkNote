using System.Net;
using System.Net.Http.Json;
using DotNet.Testcontainers.Builders;
using DotNet.Testcontainers.Containers;
using InkNote.Api.Common.Storage;
using InkNote.Api.Modules.Attachments.Application;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Tests;

/// <summary>
/// The API with a REAL S3-compatible storage (MinIO in a container) instead of the fake: what the fake cannot prove
/// (that the signed URLs really work, expire, and cannot be forged, and that the bucket is private).
/// </summary>
public sealed class MinioFixture : ApiFixture
{
    private const string AccessKey = "test-access-key";
    private const string SecretKey = "test-secret-key-0123456789";
    public const string Bucket = "inknote-test";

    // The same image as docker-compose.yml.
    private readonly IContainer minio = new ContainerBuilder("bitnamilegacy/minio:latest")
        .WithEnvironment("MINIO_ROOT_USER", AccessKey)
        .WithEnvironment("MINIO_ROOT_PASSWORD", SecretKey)
        .WithPortBinding(9000, true)
        .WithWaitStrategy(Wait.ForUnixContainer().UntilHttpRequestIsSucceeded(r => r.ForPort(9000).ForPath("/minio/health/live")))
        .Build();

    protected override bool UseFakeStorage => false;

    public string Endpoint => $"http://{minio.Hostname}:{minio.GetMappedPublicPort(9000)}";

    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Storage:ServiceUrl"] = Endpoint,
        ["Storage:AccessKey"] = AccessKey,
        ["Storage:SecretKey"] = SecretKey,
        ["Storage:Bucket"] = Bucket,
        ["Storage:CreateBucketIfMissing"] = "true",
        ["Attachments:UrlLifetime"] = "00:00:03", // short, to see a URL expire
    };

    public override async Task InitializeAsync()
    {
        await minio.StartAsync(); // first: the API creates the bucket when it starts
        await base.InitializeAsync();
    }

    protected override async Task DisposeAsyncCore()
    {
        await base.DisposeAsyncCore();
        await minio.DisposeAsync();
    }
}

public sealed class RealStorageTests(MinioFixture api) : AttachmentTestBase(api), IClassFixture<MinioFixture>
{
    // A plain client: no token, no cookies. This is what the browser does with a presigned URL.
    private static readonly HttpClient Anonymous = new();

    [Fact]
    public async Task An_image_uploaded_through_the_API_is_downloaded_from_the_storage_with_the_presigned_URL()
    {
        var note = await CreateNoteAsync();
        var bytes = Files.Png(2048);
        var dto = await UploadOkAsync(note, bytes, "cat.png");

        var url = await UrlAsync(dto.Id);
        var response = await Anonymous.GetAsync(url!.Url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(bytes, await response.Content.ReadAsByteArrayAsync());
        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("inline", response.Content.Headers.ContentDisposition!.DispositionType);
    }

    [Fact]
    public async Task A_PDF_is_served_as_a_download_with_its_name()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Pdf(500), "báo cáo.pdf");

        var response = await Anonymous.GetAsync((await UrlAsync(dto.Id))!.Url);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType!.MediaType);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition!.DispositionType);
        Assert.Equal("báo cáo.pdf", response.Content.Headers.ContentDisposition.FileNameStar);
    }

    [Fact]
    public async Task The_storage_answers_with_the_type_the_server_decided_not_one_the_client_could_have_chosen()
    {
        var note = await CreateNoteAsync();
        // Declared as HTML by the client, but the bytes are a PNG: it is a PNG, and is served as one.
        var form = new MultipartFormDataContent
        {
            { new StringContent(Guid.NewGuid().ToString()), "id" },
            { new StringContent(note.ToString()), "noteId" },
        };
        var file = new ByteArrayContent(Files.Png());
        file.Headers.ContentType = new("text/html");
        form.Add(file, "file", "page.html");
        var dto = (await (await Client.PostAsync("/api/attachments", form)).Content.ReadFromJsonAsync<AttachmentDto>())!;

        var response = await Anonymous.GetAsync((await UrlAsync(dto.Id))!.Url);

        Assert.Equal("image/png", response.Content.Headers.ContentType!.MediaType);
    }

    [Fact]
    public async Task The_bucket_is_private_the_bare_address_of_a_file_is_refused()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "secret.png");
        var signed = new Uri((await UrlAsync(dto.Id))!.Url);

        var bare = await Anonymous.GetAsync(signed.GetLeftPart(UriPartial.Path)); // the same address without the signature

        Assert.Equal(HttpStatusCode.Forbidden, bare.StatusCode);
    }

    [Fact]
    public async Task A_URL_for_a_different_file_cannot_be_forged_by_editing_the_signed_one()
    {
        var note = await CreateNoteAsync();
        var mine = await UploadOkAsync(note, Files.Png(), "mine.png");
        var other = Api.CreateUserClient(out var otherAuth);
        var othersFile = await UploadOkAsync(await CreateNoteAsync(other), Files.Png(), "theirs.png", other);
        var signedForMine = (await UrlAsync(mine.Id))!.Url;

        // Swap the file in the path, keep the signature: the signature covers the path, so it no longer fits.
        var forged = signedForMine.Replace($"{UserId:N}/{mine.Id:N}", $"{otherAuth.User.Id:N}/{othersFile.Id:N}");
        var response = await Anonymous.GetAsync(forged);

        Assert.NotEqual(signedForMine, forged);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Fact]
    public async Task A_URL_stops_working_when_it_expires()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "short-lived.png");
        var url = (await UrlAsync(dto.Id))!.Url;
        Assert.Equal(HttpStatusCode.OK, (await Anonymous.GetAsync(url)).StatusCode); // works now

        await Task.Delay(TimeSpan.FromSeconds(4.5));

        Assert.Equal(HttpStatusCode.Forbidden, (await Anonymous.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Deleting_an_attachment_removes_the_object_from_the_storage()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "temporary.png");
        var url = (await UrlAsync(dto.Id))!.Url;
        Assert.Equal(HttpStatusCode.OK, (await Anonymous.GetAsync(url)).StatusCode);

        (await Client.DeleteAsync($"/api/attachments/{dto.Id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await Anonymous.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_note_for_good_removes_its_objects_from_the_storage()
    {
        var note = await CreateNoteAsync();
        var png = await UploadOkAsync(note, Files.Png(), "a.png");
        var pdf = await UploadOkAsync(note, Files.Pdf(), "b.pdf");
        var urls = new[] { (await UrlAsync(png.Id))!.Url, (await UrlAsync(pdf.Id))!.Url };
        (await Client.DeleteAsync($"/api/notes/{note}")).EnsureSuccessStatusCode();

        (await Client.DeleteAsync($"/api/notes/trash/{note}")).EnsureSuccessStatusCode();

        foreach (var url in urls)
        {
            Assert.Equal(HttpStatusCode.NotFound, (await Anonymous.GetAsync(url)).StatusCode);
        }
    }

    [Fact]
    public async Task Uploading_the_same_id_twice_keeps_one_object_and_the_second_answer_is_200()
    {
        var note = await CreateNoteAsync();
        var id = Guid.NewGuid();
        var bytes = Files.Png(300);

        var first = await UploadAsync(id, note, bytes, "twice.png");
        var second = await UploadAsync(id, note, bytes, "twice.png");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        var downloaded = await Anonymous.GetByteArrayAsync((await UrlAsync(id))!.Url);
        Assert.Equal(bytes, downloaded);
    }
}

/// <summary>Signing is a local calculation: the URL's address, signature and overrides can be checked without a server.</summary>
public sealed class PresignedUrlTests
{
    private static S3ObjectStorage Create(string? publicUrl = null) => new(Options.Create(new StorageOptions
    {
        ServiceUrl = "http://storage-inside-docker:9000",
        PublicUrl = publicUrl ?? string.Empty,
        AccessKey = "AKIAEXAMPLE",
        SecretKey = "secret-for-the-test",
        Bucket = "bucket",
    }));

    [Fact]
    public void The_URL_carries_the_bucket_the_key_a_signature_an_expiry_and_the_response_overrides()
    {
        using var storage = Create();

        var url = new Uri(storage.CreateDownloadUrl("user/file", TimeSpan.FromMinutes(5), "image/png", "inline"));
        var query = System.Web.HttpUtility.ParseQueryString(url.Query);

        Assert.Equal("/bucket/user/file", url.AbsolutePath);
        Assert.Equal("300", query["X-Amz-Expires"]);
        Assert.False(string.IsNullOrEmpty(query["X-Amz-Signature"]));
        Assert.Equal("image/png", query["response-content-type"]);
        Assert.Equal("inline", query["response-content-disposition"]);
        Assert.DoesNotContain("secret-for-the-test", url.ToString()); // the secret key never appears in a URL
    }

    [Fact]
    public void Without_a_public_address_the_URL_points_at_the_service_address()
    {
        using var storage = Create();

        var url = new Uri(storage.CreateDownloadUrl("k", TimeSpan.FromMinutes(1), "image/png", "inline"));

        Assert.Equal("storage-inside-docker", url.Host);
    }

    [Fact]
    public void The_URL_keeps_the_protocol_of_the_address_so_MinIO_over_plain_http_gives_http_URLs()
    {
        using var storage = Create(); // http://storage-inside-docker:9000

        var url = new Uri(storage.CreateDownloadUrl("k", TimeSpan.FromMinutes(1), "image/png", "inline"));

        Assert.Equal("http", url.Scheme);
        Assert.Equal(9000, url.Port);
    }

    [Fact]
    public void The_URL_uses_the_PUBLIC_address_when_the_browser_reaches_the_storage_another_way()
    {
        using var storage = Create(publicUrl: "https://files.example.com");

        var url = new Uri(storage.CreateDownloadUrl("k", TimeSpan.FromMinutes(1), "image/png", "inline"));

        Assert.Equal("files.example.com", url.Host);
        Assert.Equal("https", url.Scheme);
    }

    [Fact]
    public void A_different_key_gets_a_different_signature()
    {
        using var storage = Create();

        string Signature(string key) =>
            System.Web.HttpUtility.ParseQueryString(new Uri(storage.CreateDownloadUrl(key, TimeSpan.FromMinutes(1), "image/png", "inline")).Query)["X-Amz-Signature"]!;

        Assert.NotEqual(Signature("user/one"), Signature("user/two"));
    }
}
