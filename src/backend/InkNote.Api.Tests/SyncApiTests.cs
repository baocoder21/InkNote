using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Sync.Application;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Modules.Tags.Application;

namespace InkNote.Api.Tests;

/// <summary>Helpers shared by the sync test classes.</summary>
public abstract class SyncTestBase(ApiFixture api)
{
    protected readonly HttpClient Client = api.CreateUserClient();
    protected ApiFixture Api => api;

    protected static JsonElement Json(object? data) => JsonSerializer.SerializeToElement(data);

    protected static SyncOperation Upsert(string entity, Guid id, object data, int? baseVersion = null, Guid? opId = null) =>
        new(opId ?? Guid.NewGuid(), entity, id, SyncKinds.Upsert, baseVersion, Json(data));

    protected static SyncOperation Delete(string entity, Guid id, Guid? opId = null) =>
        new(opId ?? Guid.NewGuid(), entity, id, SyncKinds.Delete, null, null);

    protected async Task<PushResponse> PushAsync(HttpClient client, params SyncOperation[] operations)
    {
        var response = await client.PostAsJsonAsync("/api/sync/push", new PushRequest(operations));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PushResponse>())!;
    }

    protected Task<PushResponse> PushAsync(params SyncOperation[] operations) => PushAsync(Client, operations);

    protected async Task<OperationResultDto> PushOneAsync(SyncOperation operation, HttpClient? client = null) =>
        (await PushAsync(client ?? Client, operation)).Results.Single();

    protected async Task<PullResponse> PullAsync(long cursor = 0, int limit = 200, HttpClient? client = null)
    {
        var response = await (client ?? Client).GetAsync($"/api/sync/pull?cursor={cursor}&limit={limit}");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<PullResponse>())!;
    }

    /// <summary>Everything after `cursor`, following the pages.</summary>
    protected async Task<(List<SyncChange> Changes, long Cursor)> PullAllAsync(long cursor = 0, int pageSize = 200, HttpClient? client = null)
    {
        var all = new List<SyncChange>();
        PullResponse page;
        do
        {
            page = await PullAsync(cursor, pageSize, client);
            all.AddRange(page.Changes);
            cursor = page.Cursor;
        } while (page.HasMore);

        return (all, cursor);
    }

    protected static string Str(object? data, string property) => ((JsonElement)data!).GetProperty(property).GetString()!;
    protected static int Int(object? data, string property) => ((JsonElement)data!).GetProperty(property).GetInt32();
    protected static bool Bool(object? data, string property) => ((JsonElement)data!).GetProperty(property).GetBoolean();

    protected async Task<NoteDto> GetNoteAsync(Guid id, HttpClient? client = null) =>
        (await (client ?? Client).GetFromJsonAsync<NoteDto>($"/api/notes/{id}"))!;

    protected async Task<HttpStatusCode> NoteStatusAsync(Guid id, HttpClient? client = null) =>
        (await (client ?? Client).GetAsync($"/api/notes/{id}")).StatusCode;

    /// <summary>
    /// The revisions of ONE kind, with their whole text. By default the ones a CONFLICT made: that is what the sync tests
    /// are about (the automatic "edit" snapshots of a note have their own tests in NoteRevisionTests).
    /// </summary>
    protected async Task<List<NoteRevisionDto>> RevisionsAsync(Guid noteId, HttpClient? client = null, string reason = NoteRevision.ConflictReason)
    {
        var http = client ?? Client;
        var summaries = (await http.GetFromJsonAsync<List<NoteRevisionSummaryDto>>($"/api/notes/{noteId}/revisions"))!;
        var full = new List<NoteRevisionDto>();
        foreach (var summary in summaries.Where(s => s.Reason == reason))
        {
            full.Add((await http.GetFromJsonAsync<NoteRevisionDto>($"/api/notes/{noteId}/revisions/{summary.Id}"))!);
        }

        return full;
    }

    protected async Task<NoteDto> RestCreateNoteAsync(string title, string content = "x")
    {
        var response = await Client.PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, content));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }
}

/// <summary>Pulling: what changed, in which order, in pages, and for whom.</summary>
public sealed class SyncPullTests(ApiFixture api) : SyncTestBase(api), IClassFixture<ApiFixture>
{
    [Fact]
    public async Task A_new_user_pulls_nothing_and_keeps_cursor_0()
    {
        var page = await PullAsync();

        Assert.Empty(page.Changes);
        Assert.Equal(0, page.Cursor);
        Assert.False(page.HasMore);
    }

    [Fact]
    public async Task Pull_returns_everything_made_through_the_normal_API_and_then_nothing_new()
    {
        var notebook = (await (await Client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Folder", null))).Content.ReadFromJsonAsync<NotebookDto>())!;
        var tag = (await (await Client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"t-{Guid.NewGuid():N}"))).Content.ReadFromJsonAsync<TagDto>())!;
        var note = await RestCreateNoteAsync("First", "body");

        var (changes, cursor) = await PullAllAsync();

        Assert.Equal(3, changes.Count);
        Assert.Equal(changes.Select(c => c.Seq).OrderBy(s => s), changes.Select(c => c.Seq)); // oldest first
        Assert.Equal(new[] { "notebook", "tag", "note" }, changes.Select(c => c.Entity));
        Assert.Contains(changes, c => c.Id == notebook.Id && Str(c.Data, "name") == "Folder");
        Assert.Contains(changes, c => c.Id == tag.Id);
        var noteChange = changes.Single(c => c.Id == note.Id);
        Assert.Equal("body", Str(noteChange.Data, "content")); // notes arrive WITH their content
        Assert.Equal(changes.Max(c => c.Seq), cursor);

        var again = await PullAsync(cursor);
        Assert.Empty(again.Changes);
        Assert.Equal(cursor, again.Cursor);
    }

    [Fact]
    public async Task Every_kind_of_change_made_through_the_normal_API_shows_up_after_the_cursor()
    {
        var note = await RestCreateNoteAsync("Original");
        var (_, cursor) = await PullAllAsync();

        // edit the text
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Edited", "new", note.Version))).EnsureSuccessStatusCode();
        var afterEdit = await PullAsync(cursor);
        Assert.Equal("Edited", Str(afterEdit.Changes.Single().Data, "title"));

        // organization only (UpdatedAt does not move, but the change must still be seen)
        var current = await GetNoteAsync(note.Id);
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(null, true, NoteStatus.Active, [], current.Version))).EnsureSuccessStatusCode();
        var afterOrganize = await PullAsync(afterEdit.Cursor);
        Assert.True(Bool(afterOrganize.Changes.Single().Data, "isPinned"));

        // move to the trash: reported as a deletion
        await Client.DeleteAsync($"/api/notes/{note.Id}");
        var afterDelete = await PullAsync(afterOrganize.Cursor);
        var deletion = Assert.Single(afterDelete.Changes);
        Assert.True(deletion.Deleted);
        Assert.Equal(note.Id, deletion.Id);
        Assert.Null(deletion.Data);

        // restored: it is a note again
        await Client.PostAsync($"/api/notes/trash/{note.Id}/restore", null);
        var afterRestore = await PullAsync(afterDelete.Cursor);
        Assert.False(afterRestore.Changes.Single().Deleted);
    }

    [Fact]
    public async Task Deleting_for_good_and_deleting_notebooks_and_tags_leave_tombstones()
    {
        var notebook = (await (await Client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Short", null))).Content.ReadFromJsonAsync<NotebookDto>())!;
        var tag = (await (await Client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"t-{Guid.NewGuid():N}"))).Content.ReadFromJsonAsync<TagDto>())!;
        var note = await RestCreateNoteAsync("Gone for good");
        await Client.DeleteAsync($"/api/notes/{note.Id}"); // trash
        var (_, cursor) = await PullAllAsync();

        await Client.DeleteAsync($"/api/notebooks/{notebook.Id}");
        await Client.DeleteAsync($"/api/tags/{tag.Id}");
        await Client.DeleteAsync($"/api/notes/trash/{note.Id}"); // delete forever: the row disappears

        var (changes, _) = await PullAllAsync(cursor);
        Assert.Contains(changes, c => c.Deleted && c.Entity == "notebook" && c.Id == notebook.Id);
        Assert.Contains(changes, c => c.Deleted && c.Entity == "tag" && c.Id == tag.Id);
        Assert.Contains(changes, c => c.Deleted && c.Entity == "note" && c.Id == note.Id);
    }

    [Fact]
    public async Task A_change_made_by_the_database_itself_is_seen_too()
    {
        // Deleting a notebook makes the DATABASE set notes.notebook_id to NULL on the notes that were in it (here: a
        // trashed one; a live note would have blocked the deletion). No application code touches those rows, yet they
        // changed. The trigger on the table stamps them, so a device still hears about it.
        var notebook = (await (await Client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Temp", null))).Content.ReadFromJsonAsync<NotebookDto>())!;
        var note = (await (await Client.PostAsJsonAsync("/api/notes", new CreateNoteRequest("In folder", "x", notebook.Id))).Content.ReadFromJsonAsync<NoteDto>())!;
        await Client.DeleteAsync($"/api/notes/{note.Id}"); // into the trash
        var (_, cursor) = await PullAllAsync();

        await Client.DeleteAsync($"/api/notebooks/{notebook.Id}");
        var (changes, _) = await PullAllAsync(cursor);

        Assert.Contains(changes, c => c.Deleted && c.Entity == "notebook" && c.Id == notebook.Id);
        Assert.Contains(changes, c => c.Entity == "note" && c.Id == note.Id && c.Deleted); // reported again, still deleted
    }

    [Fact]
    public async Task Pages_cover_every_change_once_and_say_when_there_is_more()
    {
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            ids.Add((await RestCreateNoteAsync($"Note {i}")).Id);
        }

        var first = await PullAsync(0, 2);
        Assert.Equal(2, first.Changes.Count);
        Assert.True(first.HasMore);
        var second = await PullAsync(first.Cursor, 2);
        Assert.True(second.HasMore);
        var third = await PullAsync(second.Cursor, 2);
        Assert.Single(third.Changes);
        Assert.False(third.HasMore);

        var seen = first.Changes.Concat(second.Changes).Concat(third.Changes).Select(c => c.Id).ToList();
        Assert.Equal(5, seen.Distinct().Count());
        Assert.True(ids.All(seen.Contains));
        Assert.Equal(ids, seen); // and in the order they were made
    }

    [Fact]
    public async Task A_note_changed_again_is_reported_again_with_a_higher_position()
    {
        var note = await RestCreateNoteAsync("Twice");
        var (first, cursor) = await PullAllAsync();
        var before = first.Single(c => c.Id == note.Id).Seq;

        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Twice!", "x", note.Version))).EnsureSuccessStatusCode();
        var (second, _) = await PullAllAsync(cursor);

        Assert.Equal(note.Id, second.Single().Id);
        Assert.True(second.Single().Seq > before);
    }

    [Fact]
    public async Task One_user_never_pulls_another_users_changes_or_deletions()
    {
        var bob = Api.CreateUserClient();
        var alicesNote = await RestCreateNoteAsync("Alice only");
        await Client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"alice-{Guid.NewGuid():N}"));
        var doomed = await RestCreateNoteAsync("Alice doomed");
        await Client.DeleteAsync($"/api/notes/{doomed.Id}");
        await Client.DeleteAsync($"/api/notes/trash/{doomed.Id}"); // a tombstone of Alice's

        var (bobSees, _) = await PullAllAsync(client: bob);

        Assert.Empty(bobSees);
        var (aliceSees, _) = await PullAllAsync();
        Assert.Contains(aliceSees, c => c.Id == alicesNote.Id);
    }

    [Theory]
    [InlineData("-1", "10")]
    [InlineData("0", "0")]
    [InlineData("0", "501")]
    public async Task Bad_pull_parameters_are_a_400(string cursor, string limit)
    {
        var response = await Client.GetAsync($"/api/sync/pull?cursor={cursor}&limit={limit}");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Sync_endpoints_need_a_signed_in_user()
    {
        var anonymous = Api.CreateAnonymousClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/sync/pull")).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.PostAsJsonAsync("/api/sync/push", new PushRequest([]))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync($"/api/notes/{Guid.NewGuid()}/revisions")).StatusCode);
    }
}
