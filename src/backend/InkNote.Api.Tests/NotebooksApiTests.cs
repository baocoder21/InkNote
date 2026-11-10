using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notes.Application;
using Microsoft.AspNetCore.Mvc;

namespace InkNote.Api.Tests;

public sealed class NotebooksApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _client = api.CreateClient();

    private async Task<NotebookDto> CreateNotebookAsync(string name = "Notebook", Guid? parentId = null)
    {
        var response = await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest(name, parentId));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NotebookDto>())!;
    }

    [Fact]
    public async Task Create_returns_201_and_nested_notebook_keeps_its_parent()
    {
        var parent = await CreateNotebookAsync("Work");

        var response = await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Projects", parent.Id));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var child = await response.Content.ReadFromJsonAsync<NotebookDto>();
        Assert.Equal(parent.Id, child!.ParentId);

        var list = await _client.GetFromJsonAsync<List<NotebookDto>>("/api/notebooks");
        Assert.Contains(list!, n => n.Id == child.Id && n.ParentId == parent.Id);
    }

    [Fact]
    public async Task Create_with_empty_name_returns_400_and_unknown_parent_returns_400()
    {
        var empty = await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("", null));
        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);

        var orphan = await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("X", Guid.NewGuid()));
        Assert.Equal(HttpStatusCode.BadRequest, orphan.StatusCode);
        var problem = await orphan.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.Contains("parentId", problem!.Errors.Keys);
    }

    [Fact]
    public async Task Rename_and_move_work()
    {
        var a = await CreateNotebookAsync("A");
        var b = await CreateNotebookAsync("B");

        var response = await _client.PutAsJsonAsync($"/api/notebooks/{b.Id}", new UpdateNotebookRequest("B renamed", a.Id));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<NotebookDto>();
        Assert.Equal("B renamed", updated!.Name);
        Assert.Equal(a.Id, updated.ParentId);
    }

    [Fact]
    public async Task Moving_a_notebook_into_itself_or_its_descendant_is_rejected()
    {
        var root = await CreateNotebookAsync("Root");
        var child = await CreateNotebookAsync("Child", root.Id);
        var grandchild = await CreateNotebookAsync("Grandchild", child.Id);

        // Into itself.
        var self = await _client.PutAsJsonAsync($"/api/notebooks/{root.Id}", new UpdateNotebookRequest("Root", root.Id));
        Assert.Equal(HttpStatusCode.BadRequest, self.StatusCode);

        // Into a grandchild would create the loop Root -> Child -> Grandchild -> Root.
        var loop = await _client.PutAsJsonAsync($"/api/notebooks/{root.Id}", new UpdateNotebookRequest("Root", grandchild.Id));
        Assert.Equal(HttpStatusCode.BadRequest, loop.StatusCode);

        // The tree is unchanged.
        var list = await _client.GetFromJsonAsync<List<NotebookDto>>("/api/notebooks");
        Assert.Null(list!.Single(n => n.Id == root.Id).ParentId);
    }

    [Fact]
    public async Task Update_unknown_notebook_returns_404()
    {
        var response = await _client.PutAsJsonAsync($"/api/notebooks/{Guid.NewGuid()}", new UpdateNotebookRequest("X", null));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_empty_notebook_returns_204_and_it_disappears()
    {
        var notebook = await CreateNotebookAsync("Temporary");

        var delete = await _client.DeleteAsync($"/api/notebooks/{notebook.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        var list = await _client.GetFromJsonAsync<List<NotebookDto>>("/api/notebooks");
        Assert.DoesNotContain(list!, n => n.Id == notebook.Id);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/notebooks/{notebook.Id}")).StatusCode);
    }

    [Fact]
    public async Task Delete_notebook_with_a_sub_notebook_returns_409()
    {
        var parent = await CreateNotebookAsync("Parent");
        await CreateNotebookAsync("Child", parent.Id);

        var delete = await _client.DeleteAsync($"/api/notebooks/{parent.Id}");

        Assert.Equal(HttpStatusCode.Conflict, delete.StatusCode);
    }

    [Fact]
    public async Task Delete_notebook_with_a_note_returns_409_until_the_note_is_gone()
    {
        var notebook = await CreateNotebookAsync("Has notes");
        var create = await _client.PostAsJsonAsync(
            "/api/notes", new CreateNoteRequest("In notebook", "body", notebook.Id));
        var note = (await create.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal(notebook.Id, note.NotebookId);

        Assert.Equal(HttpStatusCode.Conflict, (await _client.DeleteAsync($"/api/notebooks/{notebook.Id}")).StatusCode);

        // A soft-deleted note no longer counts as content, so the notebook can go.
        await _client.DeleteAsync($"/api/notes/{note.Id}");
        Assert.Equal(HttpStatusCode.NoContent, (await _client.DeleteAsync($"/api/notebooks/{notebook.Id}")).StatusCode);
    }
}
