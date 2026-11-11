using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using InkNote.Api.Modules.Attachments.Application;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Modules.Notes.Application;

namespace InkNote.Api.Tests;

/// <summary>Bytes that start like real files (only the start matters to the server: it looks at the magic bytes).</summary>
public static class Files
{
    private static byte[] Padded(byte[] start, int size)
    {
        var bytes = new byte[Math.Max(size, start.Length)];
        start.CopyTo(bytes, 0);
        return bytes;
    }

    public static byte[] Png(int size = 64) => Padded([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A], size);
    public static byte[] Jpeg(int size = 64) => Padded([0xFF, 0xD8, 0xFF, 0xE0], size);
    public static byte[] Gif(int size = 64) => Padded("GIF89a"u8.ToArray(), size);
    public static byte[] Webp(int size = 64) => Padded([.. "RIFF"u8, 0, 0, 0, 0, .. "WEBP"u8], size);
    public static byte[] Pdf(int size = 64) => Padded("%PDF-1.7\n"u8.ToArray(), size);
    public static byte[] Text(string text) => Encoding.UTF8.GetBytes(text);
}

public abstract class AttachmentTestBase
{
    protected readonly ApiFixture Api;
    protected readonly HttpClient Client;
    protected readonly Guid UserId;

    protected AttachmentTestBase(ApiFixture api)
    {
        Api = api;
        Client = api.CreateUserClient(out var auth);
        UserId = auth.User.Id;
    }

    protected static async Task<Guid> CreateNoteAsync(HttpClient client, string title = "A note")
    {
        var response = await client.PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, "text"));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!.Id;
    }

    protected Task<Guid> CreateNoteAsync(string title = "A note") => CreateNoteAsync(Client, title);

    protected static Task<HttpResponseMessage> UploadAsync(
        HttpClient client, Guid id, Guid noteId, byte[] bytes, string fileName, string declaredType = "application/octet-stream")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(id.ToString()), "id" },
            { new StringContent(noteId.ToString()), "noteId" },
        };
        var file = new ByteArrayContent(bytes);
        file.Headers.ContentType = MediaTypeHeaderValue.Parse(declaredType);
        form.Add(file, "file", fileName);
        return client.PostAsync("/api/attachments", form);
    }

    protected Task<HttpResponseMessage> UploadAsync(Guid id, Guid noteId, byte[] bytes, string fileName, string declaredType = "application/octet-stream") =>
        UploadAsync(Client, id, noteId, bytes, fileName, declaredType);

    /// <summary>Uploads a file that is expected to be accepted.</summary>
    protected async Task<AttachmentDto> UploadOkAsync(Guid noteId, byte[] bytes, string fileName, HttpClient? client = null, Guid? id = null)
    {
        var response = await UploadAsync(client ?? Client, id ?? Guid.NewGuid(), noteId, bytes, fileName);
        Assert.True(response.IsSuccessStatusCode, $"upload answered {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return (await response.Content.ReadFromJsonAsync<AttachmentDto>())!;
    }

    protected async Task<string?> ProblemTitleAsync(HttpResponseMessage response) =>
        (await response.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("title").GetString();

    protected Task<AttachmentUrlDto?> UrlAsync(Guid id, bool? download = null, HttpClient? client = null) =>
        (client ?? Client).GetFromJsonAsync<AttachmentUrlDto>($"/api/attachments/{id}/url" + (download is null ? "" : $"?download={download.ToString()!.ToLowerInvariant()}"));

    protected string KeyOf(Guid id) => $"{UserId:N}/{id:N}";
}

/// <summary>Uploading: what is accepted, where it goes, and what is refused.</summary>
public sealed class AttachmentUploadTests(ApiFixture api) : AttachmentTestBase(api), IClassFixture<ApiFixture>
{
    [Fact]
    public async Task A_png_is_stored_in_the_object_storage_under_a_key_made_of_ids_only()
    {
        var note = await CreateNoteAsync();
        var bytes = Files.Png(200);
        var id = Guid.NewGuid();

        var response = await UploadAsync(id, note, bytes, "My holiday photo.png", "image/png");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var dto = (await response.Content.ReadFromJsonAsync<AttachmentDto>())!;
        Assert.Equal(new AttachmentDto(id, note, "My holiday photo.png", "image/png", 200, true, dto.CreatedAt), dto);
        var stored = Api.Storage.Objects[KeyOf(id)];
        Assert.Equal(bytes, stored.Bytes);
        Assert.Equal("image/png", stored.ContentType);
        Assert.DoesNotContain("holiday", KeyOf(id)); // nothing the user types steers where a file goes
    }

    [Theory]
    [InlineData("jpeg", "image/jpeg", true)]
    [InlineData("gif", "image/gif", true)]
    [InlineData("webp", "image/webp", true)]
    [InlineData("pdf", "application/pdf", false)]
    public async Task Every_allowed_kind_is_recognised_by_its_bytes(string kind, string expectedType, bool isImage)
    {
        var note = await CreateNoteAsync();
        var bytes = kind switch { "jpeg" => Files.Jpeg(), "gif" => Files.Gif(), "webp" => Files.Webp(), _ => Files.Pdf() };

        // Sent under a wrong declared type AND a misleading name: only the bytes count.
        var dto = await UploadOkAsync(note, bytes, "whatever.bin");

        Assert.Equal(expectedType, dto.ContentType);
        Assert.Equal(isImage, dto.IsImage);
    }

    [Theory]
    [InlineData("notes.txt")]
    [InlineData("readme.MD")]
    [InlineData("table.csv")]
    public async Task Plain_text_files_are_allowed_and_served_as_text(string name)
    {
        var note = await CreateNoteAsync();

        var dto = await UploadOkAsync(note, Files.Text("héllo, wörld\nline two"), name);

        Assert.Equal("text/plain", dto.ContentType);
        Assert.False(dto.IsImage);
    }

    [Fact]
    public async Task The_same_upload_sent_twice_stores_the_file_once_and_answers_200_the_second_time()
    {
        var note = await CreateNoteAsync();
        var id = Guid.NewGuid();
        var before = Api.Storage.PutCount;

        var first = await UploadAsync(id, note, Files.Png(), "a.png");
        var second = await UploadAsync(id, note, Files.Png(), "a.png");

        Assert.Equal(HttpStatusCode.Created, first.StatusCode);
        Assert.Equal(HttpStatusCode.OK, second.StatusCode);
        Assert.Equal(before + 1, Api.Storage.PutCount); // an upload repeated after a lost answer costs nothing
        Assert.Equal((await first.Content.ReadFromJsonAsync<AttachmentDto>())!.Id, (await second.Content.ReadFromJsonAsync<AttachmentDto>())!.Id);
    }

    [Fact]
    public async Task Two_uploads_of_the_same_id_at_the_same_time_leave_one_record_and_both_succeed()
    {
        var note = await CreateNoteAsync();
        var id = Guid.NewGuid();

        var responses = await Task.WhenAll(Enumerable.Range(0, 4).Select(_ => UploadAsync(id, note, Files.Png(), "race.png")));

        Assert.All(responses, r => Assert.True(r.IsSuccessStatusCode, r.StatusCode.ToString()));
        Assert.Equal(1, responses.Count(r => r.StatusCode == HttpStatusCode.Created));
        Assert.True(Api.Storage.Objects.ContainsKey(KeyOf(id)));
    }

    // ---------- what is refused ----------

    [Fact]
    public async Task A_script_called_png_with_a_png_content_type_is_refused_because_the_bytes_say_otherwise()
    {
        var note = await CreateNoteAsync();
        var id = Guid.NewGuid();

        var response = await UploadAsync(id, note, Files.Text("<script>alert(document.cookie)</script>"), "photo.png", "image/png");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(id))); // nothing reached the storage
    }

    [Theory]
    [InlineData("logo.svg", "image/svg+xml", "<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")]
    [InlineData("page.html", "text/html", "<html><body onload=alert(1)>")]
    [InlineData("run.exe", "application/octet-stream", "MZ\u0090\u0000\u0003")]
    [InlineData("notes.png", "image/png", "just some words, not an image")]
    [InlineData("data.bin", "application/octet-stream", "plain text with an extension that is not allowed")]
    public async Task Other_kinds_of_file_are_refused(string name, string declaredType, string content)
    {
        var note = await CreateNoteAsync();

        var response = await UploadAsync(Guid.NewGuid(), note, Files.Text(content), name, declaredType);

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task A_text_file_with_a_NUL_byte_is_a_binary_file_in_disguise_and_is_refused()
    {
        var note = await CreateNoteAsync();

        var response = await UploadAsync(Guid.NewGuid(), note, [.. "text"u8, 0, .. "more"u8], "sneaky.txt");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task A_text_file_that_is_not_valid_UTF8_is_refused()
    {
        var note = await CreateNoteAsync();

        var response = await UploadAsync(Guid.NewGuid(), note, [0xC3, 0x28, 0xA0, 0xA1], "broken.txt");

        Assert.Equal(HttpStatusCode.UnsupportedMediaType, response.StatusCode);
    }

    [Fact]
    public async Task An_empty_file_is_a_400()
    {
        var note = await CreateNoteAsync();

        var response = await UploadAsync(Guid.NewGuid(), note, [], "empty.png");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task A_request_without_a_file_or_with_a_bad_id_is_a_400()
    {
        var noFile = await Client.PostAsync("/api/attachments", new MultipartFormDataContent
        {
            { new StringContent(Guid.NewGuid().ToString()), "id" },
            { new StringContent(Guid.NewGuid().ToString()), "noteId" },
        });
        var badId = await Client.PostAsync("/api/attachments", new MultipartFormDataContent
        {
            { new StringContent("not-a-guid"), "id" },
            { new StringContent(Guid.NewGuid().ToString()), "noteId" },
            { new ByteArrayContent(Files.Png()), "file", "a.png" },
        });
        var notMultipart = await Client.PostAsJsonAsync("/api/attachments", new { id = Guid.NewGuid() });

        Assert.Equal(HttpStatusCode.BadRequest, noFile.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, badId.StatusCode);
        Assert.True((int)notMultipart.StatusCode is 400 or 415, notMultipart.StatusCode.ToString());
    }

    // ---------- the note it belongs to ----------

    [Fact]
    public async Task A_note_that_does_not_exist_is_a_404_and_nothing_is_stored()
    {
        var id = Guid.NewGuid();

        var response = await UploadAsync(id, Guid.NewGuid(), Files.Png(), "a.png");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(id)));
    }

    [Fact]
    public async Task Another_users_note_is_a_404_too_you_cannot_attach_files_to_notes_that_are_not_yours()
    {
        var other = Api.CreateUserClient();
        var othersNote = await CreateNoteAsync(other);
        var id = Guid.NewGuid();

        var response = await UploadAsync(id, othersNote, Files.Png(), "intruder.png");

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(id)));
    }

    [Fact]
    public async Task A_note_in_the_trash_still_accepts_files_it_can_be_restored()
    {
        var note = await CreateNoteAsync();
        (await Client.DeleteAsync($"/api/notes/{note}")).EnsureSuccessStatusCode();

        var response = await UploadAsync(Guid.NewGuid(), note, Files.Png(), "late.png");

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
    }

    // ---------- the file name ----------

    [Theory]
    [InlineData("../../etc/passwd.png", "passwd.png")]
    [InlineData("C:\\Users\\me\\Pictures\\cat.png", "cat.png")]
    [InlineData("...hidden.png", "hidden.png")]
    [InlineData("  spaced out.png  ", "spaced out.png")]
    public async Task The_stored_name_never_contains_a_path(string sent, string expected)
    {
        var note = await CreateNoteAsync();

        var dto = await UploadOkAsync(note, Files.Png(), sent);

        Assert.Equal(expected, dto.FileName);
    }

    [Fact]
    public async Task Invisible_direction_changing_characters_are_removed_from_the_name()
    {
        var note = await CreateNoteAsync();

        // U+202E makes what follows read right to left: "photo<RLO>gnp.exe" would LOOK like "photoexe.png".
        var dto = await UploadOkAsync(note, Files.Png(), "photo\u202Egnp.exe.png");

        Assert.Equal("photognp.exe.png", dto.FileName);
    }

    [Fact]
    public async Task A_very_long_name_is_shortened_but_keeps_its_extension()
    {
        var note = await CreateNoteAsync();

        var dto = await UploadOkAsync(note, Files.Png(), new string('x', 500) + ".png");

        Assert.Equal(255, dto.FileName.Length);
        Assert.EndsWith(".png", dto.FileName);
    }

    [Theory]
    [InlineData("a\r\nSet-Cookie: x=1.png", "aSet-Cookie: x=1.png")]
    [InlineData("tab\there.png", "tabhere.png")]
    [InlineData("", "file")]
    [InlineData("///", "file")]
    [InlineData(null, "file")]
    public void CleanFileName_removes_control_characters_and_never_returns_nothing(string? sent, string expected) =>
        Assert.Equal(expected, AttachmentService.CleanFileName(sent));
}

/// <summary>The size limits (set small for these tests): one file, and everything one user keeps.</summary>
public sealed class AttachmentLimitsFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Attachments:MaxFileBytes"] = "4096",
        ["Attachments:MaxUserBytes"] = "10000",
    };
}

public sealed class AttachmentLimitTests(AttachmentLimitsFixture api) : AttachmentTestBase(api), IClassFixture<AttachmentLimitsFixture>
{
    [Fact]
    public async Task A_file_over_the_size_limit_is_a_413_and_nothing_is_stored()
    {
        var note = await CreateNoteAsync();
        var id = Guid.NewGuid();

        var response = await UploadAsync(id, note, Files.Png(4097), "big.png");

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, response.StatusCode);
        Assert.Equal("The file is too large", await ProblemTitleAsync(response));
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(id)));
    }

    [Fact]
    public async Task A_file_exactly_at_the_limit_is_fine()
    {
        var note = await CreateNoteAsync();

        var dto = await UploadOkAsync(note, Files.Png(4096), "exact.png");

        Assert.Equal(4096, dto.SizeBytes);
    }

    [Fact]
    public async Task The_size_is_measured_from_the_bytes_received_not_from_what_the_client_declares()
    {
        var note = await CreateNoteAsync();
        var form = new MultipartFormDataContent
        {
            { new StringContent(Guid.NewGuid().ToString()), "id" },
            { new StringContent(note.ToString()), "noteId" },
        };
        var file = new ByteArrayContent(Files.Png(5000));
        file.Headers.ContentLength = 100; // a lie
        form.Add(file, "file", "liar.png");

        var response = await Client.PostAsync("/api/attachments", form);

        Assert.True(response.StatusCode is HttpStatusCode.RequestEntityTooLarge or HttpStatusCode.BadRequest, response.StatusCode.ToString());
    }

    [Fact]
    public async Task The_storage_quota_of_one_user_is_enforced_and_does_not_affect_another_user()
    {
        var note = await CreateNoteAsync();
        await UploadOkAsync(note, Files.Png(4000), "1.png");
        await UploadOkAsync(note, Files.Png(4000), "2.png");

        var third = await UploadAsync(Guid.NewGuid(), note, Files.Png(4000), "3.png"); // 12000 > 10000

        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, third.StatusCode);
        Assert.Equal("Your storage is full", await ProblemTitleAsync(third));

        var other = Api.CreateUserClient();
        var othersNote = await CreateNoteAsync(other);
        var fine = await UploadAsync(other, Guid.NewGuid(), othersNote, Files.Png(4000), "other.png");
        Assert.Equal(HttpStatusCode.Created, fine.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_file_gives_its_space_back()
    {
        var note = await CreateNoteAsync();
        var first = await UploadOkAsync(note, Files.Png(4000), "1.png");
        await UploadOkAsync(note, Files.Png(4000), "2.png");
        Assert.Equal(HttpStatusCode.RequestEntityTooLarge, (await UploadAsync(Guid.NewGuid(), note, Files.Png(4000), "3.png")).StatusCode);

        (await Client.DeleteAsync($"/api/attachments/{first.Id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.Created, (await UploadAsync(Guid.NewGuid(), note, Files.Png(4000), "3.png")).StatusCode);
    }
}

/// <summary>Reading, downloading and deleting: only for the owner.</summary>
public sealed class AttachmentAccessTests(ApiFixture api) : AttachmentTestBase(api), IClassFixture<ApiFixture>
{
    [Fact]
    public async Task The_owner_reads_the_record()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Pdf(300), "report.pdf");

        var read = await Client.GetFromJsonAsync<AttachmentDto>($"/api/attachments/{dto.Id}");

        // The database keeps microseconds, .NET ticks of 100 ns: the times agree to well within a millisecond.
        Assert.Equal(dto with { CreatedAt = read!.CreatedAt }, read);
        Assert.InRange((read.CreatedAt - dto.CreatedAt).Duration(), TimeSpan.Zero, TimeSpan.FromMilliseconds(1));
    }

    [Fact]
    public async Task Another_user_cannot_read_download_or_delete_the_file_it_is_a_404_like_any_unknown_id()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "private.png");
        var other = Api.CreateUserClient();
        var urlsBefore = Api.Storage.Urls.Count;

        var read = await other.GetAsync($"/api/attachments/{dto.Id}");
        var url = await other.GetAsync($"/api/attachments/{dto.Id}/url");
        var delete = await other.DeleteAsync($"/api/attachments/{dto.Id}");

        Assert.Equal(HttpStatusCode.NotFound, read.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, url.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);
        Assert.Equal(urlsBefore, Api.Storage.Urls.Count); // no presigned URL was even made
        Assert.True(Api.Storage.Objects.ContainsKey(KeyOf(dto.Id))); // and the file is still there
        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/api/attachments/{dto.Id}")).StatusCode);
    }

    [Fact]
    public async Task Another_user_re_uploading_somebody_elses_id_does_not_get_the_file_or_overwrite_it()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(100), "mine.png");
        var attacker = Api.CreateUserClient();
        var attackersNote = await CreateNoteAsync(attacker);

        var response = await UploadAsync(attacker, dto.Id, attackersNote, Files.Jpeg(50), "taken-over.jpg");

        Assert.False(response.IsSuccessStatusCode, response.StatusCode.ToString());
        Assert.Equal(100, Api.Storage.Objects[KeyOf(dto.Id)].Bytes.Length); // the original bytes are untouched
        Assert.Equal("mine.png", (await Client.GetFromJsonAsync<AttachmentDto>($"/api/attachments/{dto.Id}"))!.FileName);
    }

    [Fact]
    public async Task An_unknown_id_is_a_404()
    {
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/attachments/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/attachments/{Guid.NewGuid()}/url")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.DeleteAsync($"/api/attachments/{Guid.NewGuid()}")).StatusCode);
    }

    // ---------- presigned URLs ----------

    [Fact]
    public async Task An_image_gets_a_short_lived_URL_that_shows_it_inline_with_the_detected_type()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "cat.png");

        var url = await UrlAsync(dto.Id);

        var signed = Api.Storage.Urls.Last();
        Assert.Equal(KeyOf(dto.Id), signed.Key);
        Assert.Equal("inline", signed.ContentDisposition);
        Assert.Equal("image/png", signed.ContentType);
        Assert.Equal(TimeSpan.FromMinutes(5), signed.Lifetime);
        Assert.Equal(signed.Url, url!.Url);
        Assert.True(url.IsImage);
        Assert.InRange(url.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(4), DateTimeOffset.UtcNow.AddMinutes(6));
    }

    [Fact]
    public async Task An_image_can_be_forced_to_download()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "cat.png");

        await UrlAsync(dto.Id, download: true);

        Assert.StartsWith("attachment; filename=\"cat.png\"", Api.Storage.Urls.Last().ContentDisposition);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(false)]
    [InlineData(true)]
    public async Task A_file_that_is_not_an_image_is_ALWAYS_a_download_never_shown_in_the_page(bool? download)
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Pdf(), "report.pdf");

        await UrlAsync(dto.Id, download);

        var signed = Api.Storage.Urls.Last();
        Assert.StartsWith("attachment;", signed.ContentDisposition);
        Assert.Equal("application/pdf", signed.ContentType);
    }

    [Fact]
    public async Task Non_ASCII_letters_in_the_name_are_kept_in_the_encoded_form_of_the_download_header()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Pdf(), "báo cáo quý 1.pdf");

        await UrlAsync(dto.Id);

        var disposition = Api.Storage.Urls.Last().ContentDisposition;
        Assert.Equal("attachment; filename=\"b_o c_o qu_ 1.pdf\"; filename*=UTF-8''b%C3%A1o%20c%C3%A1o%20qu%C3%BD%201.pdf", disposition);
    }

    [Theory]
    [InlineData("a\"b.pdf", "filename=\"a_b.pdf\"")]            // a quote cannot end the value early
    [InlineData("a\\b.pdf", "filename=\"a_b.pdf\"")]           // nor can a backslash escape one
    [InlineData("x;y=1.pdf", "filename=\"x;y=1.pdf\"")]         // inside quotes a semicolon is just text
    public void The_download_header_cannot_be_broken_by_the_file_name(string name, string expectedPart)
    {
        var header = AttachmentService.AttachmentDisposition(name);

        Assert.StartsWith("attachment; ", header);
        Assert.Contains(expectedPart, header);
        Assert.DoesNotContain('\r', header);
        Assert.DoesNotContain('\n', header);
    }

    // ---------- deleting ----------

    [Fact]
    public async Task Deleting_removes_the_record_and_the_file()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "gone.png");

        var delete = await Client.DeleteAsync($"/api/attachments/{dto.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/attachments/{dto.Id}")).StatusCode);
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(dto.Id)));
        Assert.Equal(HttpStatusCode.NotFound, (await Client.DeleteAsync($"/api/attachments/{dto.Id}")).StatusCode);
    }
}

/// <summary>Files follow the life of their note: they stay while it can come back, and go when it is deleted for good.</summary>
public sealed class AttachmentNoteLifecycleTests(ApiFixture api) : AttachmentTestBase(api), IClassFixture<ApiFixture>
{
    [Fact]
    public async Task Moving_a_note_to_the_trash_and_back_keeps_its_files()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "kept.png");

        (await Client.DeleteAsync($"/api/notes/{note}")).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/api/attachments/{dto.Id}/url")).StatusCode); // still readable
        (await Client.PostAsync($"/api/notes/trash/{note}/restore", null)).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/api/attachments/{dto.Id}")).StatusCode);
        Assert.True(Api.Storage.Objects.ContainsKey(KeyOf(dto.Id)));
    }

    [Fact]
    public async Task Deleting_a_note_for_good_deletes_its_files_from_the_storage_and_leaves_other_notes_alone()
    {
        var doomed = await CreateNoteAsync("Doomed");
        var safe = await CreateNoteAsync("Safe");
        var a = await UploadOkAsync(doomed, Files.Png(), "a.png");
        var b = await UploadOkAsync(doomed, Files.Pdf(), "b.pdf");
        var keep = await UploadOkAsync(safe, Files.Png(), "keep.png");
        (await Client.DeleteAsync($"/api/notes/{doomed}")).EnsureSuccessStatusCode();

        var purge = await Client.DeleteAsync($"/api/notes/trash/{doomed}");

        Assert.Equal(HttpStatusCode.NoContent, purge.StatusCode);
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(a.Id)));
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(b.Id)));
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/attachments/{a.Id}")).StatusCode);
        Assert.True(Api.Storage.Objects.ContainsKey(KeyOf(keep.Id)));
        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/api/attachments/{keep.Id}")).StatusCode);
    }

    [Fact]
    public async Task Emptying_the_trash_deletes_the_files_of_every_note_in_it_but_only_of_this_user()
    {
        var n1 = await CreateNoteAsync("One");
        var n2 = await CreateNoteAsync("Two");
        var f1 = await UploadOkAsync(n1, Files.Png(), "1.png");
        var f2 = await UploadOkAsync(n2, Files.Png(), "2.png");
        var other = Api.CreateUserClient(out var otherAuth);
        var othersNote = await CreateNoteAsync(other);
        var othersFile = await UploadOkAsync(othersNote, Files.Png(), "theirs.png", other);
        (await other.DeleteAsync($"/api/notes/{othersNote}")).EnsureSuccessStatusCode(); // in THEIR trash
        (await Client.DeleteAsync($"/api/notes/{n1}")).EnsureSuccessStatusCode();
        (await Client.DeleteAsync($"/api/notes/{n2}")).EnsureSuccessStatusCode();

        (await Client.DeleteAsync("/api/notes/trash")).EnsureSuccessStatusCode();

        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(f1.Id)));
        Assert.False(Api.Storage.Objects.ContainsKey(KeyOf(f2.Id)));
        Assert.True(Api.Storage.Objects.ContainsKey($"{otherAuth.User.Id:N}/{othersFile.Id:N}")); // the other user's file is still there
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync($"/api/attachments/{othersFile.Id}")).StatusCode);
    }

    [Fact]
    public async Task A_storage_that_fails_to_delete_does_not_stop_the_note_from_being_deleted()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "stuck.png");
        (await Client.DeleteAsync($"/api/notes/{note}")).EnsureSuccessStatusCode();
        Api.Storage.DeleteFailure = new HttpRequestException("the storage is down");
        try
        {
            var purge = await Client.DeleteAsync($"/api/notes/trash/{note}");

            Assert.Equal(HttpStatusCode.NoContent, purge.StatusCode); // the user's action succeeded
            Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/attachments/{dto.Id}")).StatusCode); // the record is gone
            Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/trash/{note}")).StatusCode);
        }
        finally
        {
            Api.Storage.DeleteFailure = null;
            Api.Storage.Objects.Keys.Where(k => k.EndsWith(dto.Id.ToString("N"))).ToList().ForEach(k => Api.Storage.DeleteAsync([k], default));
        }
    }

    [Fact]
    public async Task Purging_a_note_that_is_not_in_the_trash_deletes_nothing()
    {
        var note = await CreateNoteAsync();
        var dto = await UploadOkAsync(note, Files.Png(), "live.png");

        var purge = await Client.DeleteAsync($"/api/notes/trash/{note}");

        Assert.Equal(HttpStatusCode.NotFound, purge.StatusCode);
        Assert.True(Api.Storage.Objects.ContainsKey(KeyOf(dto.Id))); // a live note's files are never touched
    }
}

/// <summary>The type detection, on its own.</summary>
public sealed class FileSnifferTests
{
    [Fact]
    public void Signatures_must_be_at_the_very_start_of_the_file()
    {
        Assert.Null(FileSniffer.Detect([0x20, .. Files.Png()], "x.png"));
        Assert.Null(FileSniffer.Detect([.. "junk"u8, .. Files.Pdf()], "x.pdf"));
    }

    [Fact]
    public void A_RIFF_file_that_is_not_WebP_is_refused()
    {
        byte[] wave = [.. "RIFF"u8, 0, 0, 0, 0, .. "WAVE"u8, 0, 0];

        Assert.Null(FileSniffer.Detect(wave, "sound.webp"));
    }

    [Fact]
    public void A_file_shorter_than_its_signature_is_refused_without_error()
    {
        Assert.Null(FileSniffer.Detect([0x89, 0x50], "x.png"));
        Assert.Null(FileSniffer.Detect([0xFF, 0xD8], "x.jpg"));
        Assert.Null(FileSniffer.Detect([], "x.txt")); // even an empty "text" has no business here (the service refuses empty files first)
    }

    [Fact]
    public void An_image_is_recognised_whatever_its_name_says()
    {
        Assert.Equal("image/png", FileSniffer.Detect(Files.Png(), "totally-a-text.txt")!.ContentType);
        Assert.True(FileSniffer.Detect(Files.Png(), "x.exe")!.IsImage);
    }

    [Fact]
    public void Text_needs_both_a_text_extension_and_valid_UTF8()
    {
        Assert.Equal("text/plain", FileSniffer.Detect(Files.Text("hello"), "a.TXT")!.ContentType);
        Assert.Null(FileSniffer.Detect(Files.Text("hello"), "a.exe"));
        Assert.Null(FileSniffer.Detect(Files.Text("hello"), "noextension"));
        Assert.Null(FileSniffer.Detect([0xFF, 0xFE, 0xFD], "a.txt"));
    }
}
