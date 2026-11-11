using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Application;

namespace InkNote.Api.Tests;

/// <summary>
/// The point of Phase 5: two accounts must never see or touch each other's data. Alice owns
/// everything; Bob tries every way in. Each "must be refused" check also looks at Alice's side
/// afterwards, because "Bob got a 404" is worthless if the data changed anyway.
/// </summary>
public sealed class UserIsolationApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _alice = api.CreateUserClient();
    private readonly HttpClient _bob = api.CreateUserClient();

    private static async Task<T> ReadAsync<T>(HttpResponseMessage response)
    {
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<T>())!;
    }

    private async Task<NoteDto> AliceNoteAsync(string title = "Alice's note", Guid? notebookId = null) =>
        await ReadAsync<NoteDto>(await _alice.PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, "private text", notebookId)));

    private async Task<NotebookDto> AliceNotebookAsync(string name = "Alice's folder") =>
        await ReadAsync<NotebookDto>(await _alice.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest(name, null)));

    private async Task<TagDto> AliceTagAsync(string? name = null) =>
        await ReadAsync<TagDto>(await _alice.PostAsJsonAsync("/api/tags", new CreateTagRequest(name ?? $"alice-{Guid.NewGuid():N}")));

    // ---------- notes ----------

    [Fact]
    public async Task Bob_does_not_see_Alices_notes_in_the_list_and_cannot_read_one_by_id()
    {
        var note = await AliceNoteAsync();

        var bobsList = (await _bob.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!;

        Assert.DoesNotContain(bobsList, n => n.Id == note.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await _bob.GetAsync($"/api/notes/{note.Id}")).StatusCode);
        // Filtering by someone else's notebook or tag id finds nothing either.
        var notebook = await AliceNotebookAsync();
        Assert.Empty((await _bob.GetFromJsonAsync<List<NoteSummaryDto>>($"/api/notes?notebookId={notebook.Id}"))!);
    }

    [Fact]
    public async Task Bob_cannot_edit_move_or_delete_Alices_note_and_it_stays_unchanged()
    {
        var note = await AliceNoteAsync();

        var edit = await _bob.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Hacked", "hacked", note.Version));
        var organize = await _bob.PutAsJsonAsync($"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(null, true, NoteStatus.Dropped, [], note.Version));
        var delete = await _bob.DeleteAsync($"/api/notes/{note.Id}");

        Assert.Equal(HttpStatusCode.NotFound, edit.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, organize.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, delete.StatusCode);
        var still = (await _alice.GetFromJsonAsync<NoteDto>($"/api/notes/{note.Id}"))!;
        Assert.Equal("Alice's note", still.Title);
        Assert.Equal("private text", still.Content);
        Assert.False(still.IsPinned);
        Assert.Equal(note.Version, still.Version);
    }

    [Fact]
    public async Task Bob_cannot_file_a_note_in_Alices_notebook_or_use_Alices_tag()
    {
        var notebook = await AliceNotebookAsync();
        var tag = await AliceTagAsync();

        var create = await _bob.PostAsJsonAsync("/api/notes", new CreateNoteRequest("Mine", "x", notebook.Id));
        Assert.Equal(HttpStatusCode.BadRequest, create.StatusCode); // "the notebook does not exist": for Bob it does not

        var bobsNote = await ReadAsync<NoteDto>(await _bob.PostAsJsonAsync("/api/notes", new CreateNoteRequest("Mine", "x")));
        var moveIn = await _bob.PutAsJsonAsync($"/api/notes/{bobsNote.Id}/organization",
            new UpdateNoteOrganizationRequest(notebook.Id, false, NoteStatus.None, [], bobsNote.Version));
        var useTag = await _bob.PutAsJsonAsync($"/api/notes/{bobsNote.Id}/organization",
            new UpdateNoteOrganizationRequest(null, false, NoteStatus.None, [tag.Id], bobsNote.Version));

        Assert.Equal(HttpStatusCode.BadRequest, moveIn.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, useTag.StatusCode);
    }

    // ---------- trash ----------

    [Fact]
    public async Task Bob_does_not_see_or_restore_or_purge_Alices_trashed_notes()
    {
        var note = await AliceNoteAsync("Trashed by Alice");
        await _alice.DeleteAsync($"/api/notes/{note.Id}");

        Assert.DoesNotContain((await _bob.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes/trash"))!, n => n.Id == note.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await _bob.GetAsync($"/api/notes/trash/{note.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _bob.PostAsync($"/api/notes/trash/{note.Id}/restore", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _bob.DeleteAsync($"/api/notes/trash/{note.Id}")).StatusCode);

        // Still in Alice's trash, untouched.
        Assert.Contains((await _alice.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes/trash"))!, n => n.Id == note.Id);
    }

    [Fact]
    public async Task Bobs_empty_trash_leaves_Alices_trash_alone()
    {
        var note = await AliceNoteAsync("Alice keeps this in the trash");
        await _alice.DeleteAsync($"/api/notes/{note.Id}");
        var bobsNote = await ReadAsync<NoteDto>(await _bob.PostAsJsonAsync("/api/notes", new CreateNoteRequest("Bob's", "x")));
        await _bob.DeleteAsync($"/api/notes/{bobsNote.Id}");

        var result = await ReadAsync<EmptyTrashResult>(await _bob.DeleteAsync("/api/notes/trash"));

        Assert.Equal(1, result.Deleted); // exactly Bob's one note
        Assert.Contains((await _alice.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes/trash"))!, n => n.Id == note.Id);
        // ...and Alice can still restore it.
        Assert.Equal(HttpStatusCode.OK, (await _alice.PostAsync($"/api/notes/trash/{note.Id}/restore", null)).StatusCode);
    }

    // ---------- notebooks ----------

    [Fact]
    public async Task Bob_does_not_see_and_cannot_change_Alices_notebooks()
    {
        var notebook = await AliceNotebookAsync("Secret folder");

        Assert.DoesNotContain((await _bob.GetFromJsonAsync<List<NotebookDto>>("/api/notebooks"))!, n => n.Id == notebook.Id);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _bob.PutAsJsonAsync($"/api/notebooks/{notebook.Id}", new UpdateNotebookRequest("Renamed by Bob", null))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _bob.DeleteAsync($"/api/notebooks/{notebook.Id}")).StatusCode);
        // Bob cannot hang his own folder under Alice's either.
        Assert.Equal(HttpStatusCode.BadRequest,
            (await _bob.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Sneaky child", notebook.Id))).StatusCode);

        var still = (await _alice.GetFromJsonAsync<List<NotebookDto>>("/api/notebooks"))!.Single(n => n.Id == notebook.Id);
        Assert.Equal("Secret folder", still.Name);
    }

    // ---------- tags ----------

    [Fact]
    public async Task Bob_does_not_see_and_cannot_change_Alices_tags()
    {
        var tag = await AliceTagAsync();

        Assert.DoesNotContain((await _bob.GetFromJsonAsync<List<TagDto>>("/api/tags"))!, t => t.Id == tag.Id);
        Assert.Equal(HttpStatusCode.NotFound,
            (await _bob.PutAsJsonAsync($"/api/tags/{tag.Id}", new UpdateTagRequest("renamed-by-bob"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _bob.DeleteAsync($"/api/tags/{tag.Id}")).StatusCode);

        Assert.Contains((await _alice.GetFromJsonAsync<List<TagDto>>("/api/tags"))!, t => t.Id == tag.Id && t.Name == tag.Name);
    }

    [Fact]
    public async Task Two_users_may_both_have_a_tag_with_the_same_name_but_one_user_may_not_have_it_twice()
    {
        var name = $"shared-{Guid.NewGuid():N}";

        Assert.Equal(HttpStatusCode.Created, (await _alice.PostAsJsonAsync("/api/tags", new CreateTagRequest(name))).StatusCode);
        Assert.Equal(HttpStatusCode.Created, (await _bob.PostAsJsonAsync("/api/tags", new CreateTagRequest(name))).StatusCode);

        Assert.Equal(HttpStatusCode.Conflict, (await _alice.PostAsJsonAsync("/api/tags", new CreateTagRequest(name.ToUpperInvariant()))).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_tag_only_affects_its_owner()
    {
        var name = $"same-{Guid.NewGuid():N}";
        var alicesTag = await ReadAsync<TagDto>(await _alice.PostAsJsonAsync("/api/tags", new CreateTagRequest(name)));
        var bobsTag = await ReadAsync<TagDto>(await _bob.PostAsJsonAsync("/api/tags", new CreateTagRequest(name)));

        Assert.Equal(HttpStatusCode.NoContent, (await _bob.DeleteAsync($"/api/tags/{bobsTag.Id}")).StatusCode);

        Assert.Contains((await _alice.GetFromJsonAsync<List<TagDto>>("/api/tags"))!, t => t.Id == alicesTag.Id);
    }

    // ---------- nobody signed in ----------

    public static TheoryData<string, string> EveryProtectedEndpoint()
    {
        var id = Guid.NewGuid();
        return new TheoryData<string, string>
        {
            { "GET", "/api/notes" },
            { "GET", "/api/notes/search?q=a" },
            { "GET", "/api/sync/pull" },
            { "POST", "/api/sync/push" },
            { "GET", $"/api/notes/{id}/revisions" },
            { "GET", $"/api/notes/{id}/revisions/{id}" },
            { "POST", $"/api/notes/{id}/revisions/{id}/restore" },
            { "POST", "/api/notes" },
            { "GET", $"/api/notes/{id}" },
            { "PUT", $"/api/notes/{id}" },
            { "DELETE", $"/api/notes/{id}" },
            { "PUT", $"/api/notes/{id}/organization" },
            { "GET", "/api/notes/trash" },
            { "GET", $"/api/notes/trash/{id}" },
            { "POST", $"/api/notes/trash/{id}/restore" },
            { "DELETE", $"/api/notes/trash/{id}" },
            { "DELETE", "/api/notes/trash" },
            { "GET", "/api/notebooks" },
            { "POST", "/api/notebooks" },
            { "PUT", $"/api/notebooks/{id}" },
            { "DELETE", $"/api/notebooks/{id}" },
            { "GET", "/api/tags" },
            { "POST", "/api/tags" },
            { "PUT", $"/api/tags/{id}" },
            { "DELETE", $"/api/tags/{id}" },
            { "GET", "/api/auth/me" },
            { "POST", "/api/attachments" },
            { "GET", $"/api/attachments/{id}" },
            { "GET", $"/api/attachments/{id}/url" },
            { "DELETE", $"/api/attachments/{id}" },
        };
    }

    [Theory]
    [MemberData(nameof(EveryProtectedEndpoint))]
    public async Task Every_data_endpoint_answers_401_when_nobody_is_signed_in(string method, string url)
    {
        var anonymous = api.CreateAnonymousClient();

        var response = await anonymous.SendAsync(new HttpRequestMessage(new HttpMethod(method), url)
        {
            Content = method is "POST" or "PUT" ? JsonContent.Create(new { }) : null,
        });

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
