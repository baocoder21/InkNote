using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Tags.Application;

namespace InkNote.Api.Tests;

public sealed class TagsApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _client = api.CreateClient();

    // Tag names must be unique across the shared test database, so each test uses its own prefix.
    private async Task<TagDto> CreateTagAsync(string name)
    {
        var response = await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest(name));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<TagDto>())!;
    }

    [Fact]
    public async Task Create_returns_201_and_trims_the_name()
    {
        var response = await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest("  create-ok  "));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var tag = await response.Content.ReadFromJsonAsync<TagDto>();
        Assert.Equal("create-ok", tag!.Name);
    }

    [Fact]
    public async Task Create_with_blank_name_returns_400()
    {
        var response = await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest("   "));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Duplicate_name_ignoring_case_returns_409()
    {
        await CreateTagAsync("Dup-Tag");

        var response = await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest("dup-tag"));

        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
    }

    [Fact]
    public async Task Rename_to_an_existing_name_returns_409_but_changing_only_the_case_is_fine()
    {
        var a = await CreateTagAsync("rename-a");
        await CreateTagAsync("rename-b");

        var clash = await _client.PutAsJsonAsync($"/api/tags/{a.Id}", new UpdateTagRequest("RENAME-B"));
        Assert.Equal(HttpStatusCode.Conflict, clash.StatusCode);

        var recase = await _client.PutAsJsonAsync($"/api/tags/{a.Id}", new UpdateTagRequest("Rename-A"));
        Assert.Equal(HttpStatusCode.OK, recase.StatusCode);
        Assert.Equal("Rename-A", (await recase.Content.ReadFromJsonAsync<TagDto>())!.Name);
    }

    [Fact]
    public async Task Rename_unknown_tag_returns_404()
    {
        var response = await _client.PutAsJsonAsync($"/api/tags/{Guid.NewGuid()}", new UpdateTagRequest("x"));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Deleting_a_tag_removes_it_from_every_note()
    {
        var tag = await CreateTagAsync("delete-me");
        var note = (await (await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest("Tagged", "x")))
            .Content.ReadFromJsonAsync<NoteDto>())!;
        var tagged = await _client.PutAsJsonAsync(
            $"/api/notes/{note.Id}/organization",
            new UpdateNoteOrganizationRequest(null, false, NoteStatus.None, [tag.Id], note.Version));
        Assert.Equal(HttpStatusCode.OK, tagged.StatusCode);

        var delete = await _client.DeleteAsync($"/api/tags/{tag.Id}");

        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);
        var reloaded = await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{note.Id}");
        Assert.Empty(reloaded!.TagIds);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.DeleteAsync($"/api/tags/{tag.Id}")).StatusCode);
    }
}
