using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Application;
using Microsoft.AspNetCore.Mvc;

namespace InkNote.Api.Tests;

/// <summary>Notebook, pin and tags on notes, and filtering the list by them.</summary>
public sealed class NoteOrganizationApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _client = api.CreateUserClient();

    private async Task<NoteDto> CreateNoteAsync(string title = "Title", Guid? notebookId = null)
    {
        var response = await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, "body", notebookId));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }

    private async Task<NotebookDto> CreateNotebookAsync(string name)
    {
        var response = await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest(name, null));
        return (await response.Content.ReadFromJsonAsync<NotebookDto>())!;
    }

    // Unique names: tag names are unique across the whole (shared) test database.
    private async Task<TagDto> CreateTagAsync() =>
        (await (await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"tag-{Guid.NewGuid():N}")))
            .Content.ReadFromJsonAsync<TagDto>())!;

    private Task<HttpResponseMessage> SetOrganizationAsync(
        NoteDto note, Guid? notebookId, bool pinned, params Guid[] tagIds) =>
        _client.PutAsJsonAsync(
            $"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(notebookId, pinned, NoteStatus.None, tagIds, note.Version));

    [Fact]
    public async Task Organization_update_sets_notebook_pin_and_tags_and_bumps_version()
    {
        var created = await CreateNoteAsync();
        // Re-read it: PostgreSQL stores microseconds while .NET keeps 100 ns ticks, so a value
        // straight from Create() would differ in its last digit from one read back from the database.
        var note = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}"))!;
        var notebook = await CreateNotebookAsync("Org");
        var tagA = await CreateTagAsync();
        var tagB = await CreateTagAsync();

        var response = await SetOrganizationAsync(note, notebook.Id, true, tagA.Id, tagB.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal(notebook.Id, updated.NotebookId);
        Assert.True(updated.IsPinned);
        Assert.Equal(new[] { tagA.Id, tagB.Id }.Order(), updated.TagIds.Order());
        Assert.Equal(note.Version + 1, updated.Version);
        // Organizing is not editing: the "last edited" time stays.
        Assert.Equal(note.UpdatedAt, updated.UpdatedAt);

        // And it is really stored.
        var reloaded = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{note.Id}"))!;
        Assert.Equal(2, reloaded.TagIds.Count);
    }

    [Fact]
    public async Task Organization_update_replaces_the_tag_set_and_ignores_duplicate_ids()
    {
        var note = await CreateNoteAsync();
        var keep = await CreateTagAsync();
        var drop = await CreateTagAsync();
        var first = (await (await SetOrganizationAsync(note, null, false, keep.Id, drop.Id))
            .Content.ReadFromJsonAsync<NoteDto>())!;

        var response = await SetOrganizationAsync(first, null, false, keep.Id, keep.Id);

        var updated = (await response.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal(new[] { keep.Id }, updated.TagIds);
    }

    [Fact]
    public async Task Organization_update_rejects_unknown_notebook_and_unknown_tag_with_400()
    {
        var note = await CreateNoteAsync();

        var badNotebook = await SetOrganizationAsync(note, Guid.NewGuid(), false);
        Assert.Equal(HttpStatusCode.BadRequest, badNotebook.StatusCode);
        Assert.Contains("notebookId", (await badNotebook.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors.Keys);

        var badTag = await SetOrganizationAsync(note, null, false, Guid.NewGuid());
        Assert.Equal(HttpStatusCode.BadRequest, badTag.StatusCode);
        Assert.Contains("tagIds", (await badTag.Content.ReadFromJsonAsync<ValidationProblemDetails>())!.Errors.Keys);

        // Nothing was saved.
        var reloaded = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{note.Id}"))!;
        Assert.Equal(note.Version, reloaded.Version);
    }

    [Fact]
    public async Task Organization_update_with_stale_version_returns_409_and_unknown_note_404()
    {
        var note = await CreateNoteAsync();
        await SetOrganizationAsync(note, null, true); // bumps the version

        var stale = await SetOrganizationAsync(note, null, false); // still holds the old version
        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);

        var missing = await _client.PutAsJsonAsync(
            $"/api/notes/{Guid.NewGuid()}/organization",
            new UpdateNoteOrganizationRequest(null, false, NoteStatus.None, [], 1));
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Status_defaults_to_none_is_saved_by_name_and_survives_a_content_edit()
    {
        var created = await CreateNoteAsync();
        var note = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}"))!;
        Assert.Equal(NoteStatus.None, note.Status);

        var response = await _client.PutAsJsonAsync(
            $"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(null, false, NoteStatus.OnHold, [], note.Version));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = (await response.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal(NoteStatus.OnHold, updated.Status);

        // The wire format is the NAME, so a client never depends on the enum's numbers.
        var raw = await _client.GetStringAsync($"/api/notes/{note.Id}");
        Assert.Contains("\"status\":\"OnHold\"", raw);

        var edited = (await (await _client.PutAsJsonAsync(
            $"/api/notes/{note.Id}", new UpdateNoteRequest("Edited", "body", updated.Version)))
            .Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal(NoteStatus.OnHold, edited.Status);

        var listed = (await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!
            .Single(n => n.Id == note.Id);
        Assert.Equal(NoteStatus.OnHold, listed.Status);
    }

    [Fact]
    public async Task Unknown_status_value_is_rejected_with_400()
    {
        var created = await CreateNoteAsync();
        var note = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}"))!;

        // A number outside the enum passes the JSON converter but must fail validation.
        var outOfRange = await _client.PutAsJsonAsync(
            $"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(null, false, (NoteStatus)42, [], note.Version));
        Assert.Equal(HttpStatusCode.BadRequest, outOfRange.StatusCode);

        var unknownName = await _client.PutAsync(
            $"/api/notes/{note.Id}/organization",
            new StringContent(
                $$"""{"notebookId":null,"isPinned":false,"status":"Nonsense","tagIds":[],"version":{{note.Version}}}""",
                System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.BadRequest, unknownName.StatusCode);
    }

    [Fact]
    public async Task Editing_the_content_keeps_notebook_pin_and_tags()
    {
        var note = await CreateNoteAsync();
        var notebook = await CreateNotebookAsync("Keep");
        var tag = await CreateTagAsync();
        var organized = (await (await SetOrganizationAsync(note, notebook.Id, true, tag.Id))
            .Content.ReadFromJsonAsync<NoteDto>())!;

        var response = await _client.PutAsJsonAsync(
            $"/api/notes/{note.Id}", new UpdateNoteRequest("Edited", "new body", organized.Version));

        var edited = (await response.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal(notebook.Id, edited.NotebookId);
        Assert.True(edited.IsPinned);
        Assert.Equal(new[] { tag.Id }, edited.TagIds);
    }

    [Fact]
    public async Task Creating_a_note_in_an_unknown_notebook_returns_400()
    {
        var response = await _client.PostAsJsonAsync(
            "/api/notes", new CreateNoteRequest("x", "y", Guid.NewGuid()));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task List_can_be_filtered_by_notebook_and_by_tag()
    {
        var notebook = await CreateNotebookAsync("Filter");
        var tag = await CreateTagAsync();
        var inNotebook = await CreateNoteAsync("in notebook", notebook.Id);
        var tagged = await CreateNoteAsync("tagged");
        await SetOrganizationAsync(tagged, null, false, tag.Id);
        var plain = await CreateNoteAsync("plain");

        var byNotebook = (await _client.GetFromJsonAsync<List<NoteSummaryDto>>($"/api/notes?notebookId={notebook.Id}"))!;
        Assert.Equal([inNotebook.Id], byNotebook.Select(n => n.Id));

        var byTag = (await _client.GetFromJsonAsync<List<NoteSummaryDto>>($"/api/notes?tagId={tag.Id}"))!;
        Assert.Equal([tagged.Id], byTag.Select(n => n.Id));
        Assert.Equal([tag.Id], byTag.Single().TagIds);

        // Without filters everything is still listed.
        var all = (await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!;
        Assert.Contains(all, n => n.Id == plain.Id);
    }

    [Fact]
    public async Task Pinned_notes_are_listed_first_even_when_older()
    {
        var older = await CreateNoteAsync("older, pinned");
        await CreateNoteAsync("newer");
        await SetOrganizationAsync(older, null, true);

        var list = (await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!;

        // Every pinned note comes before every unpinned one.
        var firstUnpinned = list.FindIndex(n => !n.IsPinned);
        Assert.True(firstUnpinned >= 0);
        Assert.DoesNotContain(list.Skip(firstUnpinned), n => n.IsPinned);
        Assert.Contains(list.Take(firstUnpinned), n => n.Id == older.Id);
    }

    [Fact]
    public async Task Deleting_a_notebook_never_leaves_a_dangling_reference_on_a_soft_deleted_note()
    {
        var notebook = await CreateNotebookAsync("Will go");
        var note = await CreateNoteAsync("soon deleted", notebook.Id);
        await _client.DeleteAsync($"/api/notes/{note.Id}");

        // The soft-deleted note still has the foreign key; ON DELETE SET NULL must let this succeed.
        var delete = await _client.DeleteAsync($"/api/notebooks/{notebook.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
    }
}
