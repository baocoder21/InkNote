using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Application;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace InkNote.Api.Tests;

/// <summary>The trash: list, look at, restore, delete for good, empty.</summary>
public sealed class TrashApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _client = api.CreateUserClient();

    private async Task<NoteDto> CreateNoteAsync(string title = "Title", Guid? notebookId = null)
    {
        var response = await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, "secret body", notebookId));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }

    private async Task<NoteDto> CreateDeletedNoteAsync(string title = "Gone")
    {
        var note = await CreateNoteAsync(title);
        (await _client.DeleteAsync($"/api/notes/{note.Id}")).EnsureSuccessStatusCode();
        return note;
    }

    private async Task<List<NoteSummaryDto>> TrashAsync() =>
        (await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes/trash"))!;

    private async Task<List<NoteSummaryDto>> LiveAsync() =>
        (await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!;

    private async Task<bool> RowExistsAsync(Guid id)
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        return await db.Notes.IgnoreQueryFilters().AnyAsync(n => n.Id == id);
    }

    [Fact]
    public async Task Trash_lists_deleted_notes_only_and_the_live_list_does_not_show_them()
    {
        var live = await CreateNoteAsync("Live");
        var deleted = await CreateDeletedNoteAsync("Deleted");

        var trash = await TrashAsync();

        Assert.Contains(trash, n => n.Id == deleted.Id);
        Assert.DoesNotContain(trash, n => n.Id == live.Id);
        Assert.DoesNotContain(await LiveAsync(), n => n.Id == deleted.Id);
    }

    [Fact]
    public async Task Trash_is_ordered_by_most_recently_deleted_first()
    {
        var first = await CreateDeletedNoteAsync("Deleted first");
        var second = await CreateDeletedNoteAsync("Deleted second");

        var ids = (await TrashAsync()).Select(n => n.Id).ToList();

        Assert.True(ids.IndexOf(second.Id) < ids.IndexOf(first.Id));
    }

    [Fact]
    public async Task A_deleted_note_can_be_read_through_the_trash_but_not_through_the_normal_endpoint()
    {
        var deleted = await CreateDeletedNoteAsync("Readable");

        var viaTrash = await _client.GetAsync($"/api/notes/trash/{deleted.Id}");
        Assert.Equal(HttpStatusCode.OK, viaTrash.StatusCode);
        var note = (await viaTrash.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal("secret body", note.Content);

        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/notes/{deleted.Id}")).StatusCode);
    }

    [Fact]
    public async Task The_trash_endpoints_never_show_or_touch_a_live_note()
    {
        var live = await CreateNoteAsync("Live and well");

        Assert.Equal(HttpStatusCode.NotFound, (await _client.GetAsync($"/api/notes/trash/{live.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync($"/api/notes/trash/{live.Id}/restore", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/notes/trash/{live.Id}")).StatusCode);

        // Still there, untouched.
        Assert.True(await RowExistsAsync(live.Id));
        Assert.Contains(await LiveAsync(), n => n.Id == live.Id);
    }

    [Fact]
    public async Task Restore_brings_the_note_back_with_its_content_pin_status_and_tags()
    {
        var notebook = (await (await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Keep", null)))
            .Content.ReadFromJsonAsync<NotebookDto>())!;
        var tag = (await (await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"tag-{Guid.NewGuid():N}")))
            .Content.ReadFromJsonAsync<TagDto>())!;
        var created = await CreateNoteAsync("Organized", notebook.Id);
        var note = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}"))!;
        (await _client.PutAsJsonAsync($"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(notebook.Id, true, NoteStatus.Active, [tag.Id], note.Version)))
            .EnsureSuccessStatusCode();
        await _client.DeleteAsync($"/api/notes/{note.Id}");
        var inTrash = (await TrashAsync()).Single(n => n.Id == note.Id);

        var response = await _client.PostAsync($"/api/notes/trash/{note.Id}/restore", null);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var restored = (await response.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal("Organized", restored.Title);
        Assert.Equal("secret body", restored.Content);
        Assert.Equal(notebook.Id, restored.NotebookId);
        Assert.True(restored.IsPinned);
        Assert.Equal(NoteStatus.Active, restored.Status);
        Assert.Equal([tag.Id], restored.TagIds);
        Assert.True(restored.Version > inTrash.Version); // a change: sync will notice it
        Assert.Contains(await LiveAsync(), n => n.Id == note.Id);
        Assert.DoesNotContain(await TrashAsync(), n => n.Id == note.Id);

        // Restoring twice: the second time it is no longer in the trash.
        Assert.Equal(HttpStatusCode.NotFound, (await _client.PostAsync($"/api/notes/trash/{note.Id}/restore", null)).StatusCode);
    }

    [Fact]
    public async Task A_note_restored_after_its_notebook_was_deleted_ends_up_in_no_notebook()
    {
        var notebook = (await (await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Short-lived", null)))
            .Content.ReadFromJsonAsync<NotebookDto>())!;
        var note = await CreateNoteAsync("Orphan", notebook.Id);
        await _client.DeleteAsync($"/api/notes/{note.Id}");

        // A note in the trash does not block deleting its notebook (only live notes do)...
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/notebooks/{notebook.Id}")).StatusCode);

        // ...and when the note comes back, it is simply not in any notebook.
        var restored = (await (await _client.PostAsync($"/api/notes/trash/{note.Id}/restore", null))
            .Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Null(restored.NotebookId);
    }

    [Fact]
    public async Task Purge_removes_the_row_and_its_tag_links_from_the_database()
    {
        var tag = (await (await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"tag-{Guid.NewGuid():N}")))
            .Content.ReadFromJsonAsync<TagDto>())!;
        var created = await CreateNoteAsync("Tagged");
        var note = (await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}"))!;
        (await _client.PutAsJsonAsync($"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(null, false, NoteStatus.None, [tag.Id], note.Version))).EnsureSuccessStatusCode();
        await _client.DeleteAsync($"/api/notes/{note.Id}");

        var response = await _client.DeleteAsync($"/api/notes/trash/{note.Id}");

        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
        Assert.False(await RowExistsAsync(note.Id)); // really gone, not just flagged
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        Assert.False(await db.Set<NoteTag>().AnyAsync(t => t.NoteId == note.Id)); // the database cascaded
        Assert.DoesNotContain(await TrashAsync(), n => n.Id == note.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/notes/trash/{note.Id}")).StatusCode);
    }

    [Fact]
    public async Task Empty_trash_deletes_every_trashed_note_and_leaves_live_notes_alone()
    {
        var live = await CreateNoteAsync("Survivor");
        var a = await CreateDeletedNoteAsync("Trash A");
        var b = await CreateDeletedNoteAsync("Trash B");

        var response = await _client.DeleteAsync("/api/notes/trash");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var result = (await response.Content.ReadFromJsonAsync<EmptyTrashResult>())!;
        Assert.True(result.Deleted >= 2);
        Assert.Empty(await TrashAsync());
        Assert.False(await RowExistsAsync(a.Id));
        Assert.False(await RowExistsAsync(b.Id));
        Assert.True(await RowExistsAsync(live.Id));
        Assert.Contains(await LiveAsync(), n => n.Id == live.Id);

        // Emptying an empty trash is not an error.
        var again = (await (await _client.DeleteAsync("/api/notes/trash")).Content.ReadFromJsonAsync<EmptyTrashResult>())!;
        Assert.Equal(0, again.Deleted);
    }
}
