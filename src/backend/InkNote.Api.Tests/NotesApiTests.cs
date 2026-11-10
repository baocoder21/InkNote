using System.Net;
using System.Net.Http.Json;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace InkNote.Api.Tests;

public sealed class NotesApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _client = api.CreateClient();

    // Each test creates its own notes, so tests do not depend on each other.
    private async Task<NoteDto> CreateNoteAsync(string title = "Title", string content = "Content")
    {
        var response = await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, content));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }

    [Fact]
    public async Task Create_returns_201_with_location_and_version_1()
    {
        var response = await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest("Hello", "# Hi"));

        Assert.Equal(HttpStatusCode.Created, response.StatusCode);
        var note = await response.Content.ReadFromJsonAsync<NoteDto>();
        Assert.NotNull(note);
        Assert.Equal("Hello", note.Title);
        Assert.Equal("# Hi", note.Content);
        Assert.Equal(1, note.Version);
        Assert.EndsWith($"/api/notes/{note.Id}", response.Headers.Location!.ToString());
    }

    [Fact]
    public async Task Create_with_empty_title_returns_400_validation_problem()
    {
        var response = await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest("", "x"));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        var problem = await response.Content.ReadFromJsonAsync<ValidationProblemDetails>();
        Assert.NotNull(problem);
        Assert.Contains("Title", problem.Errors.Keys);
    }

    [Fact]
    public async Task Get_returns_the_note_and_unknown_id_returns_404()
    {
        var created = await CreateNoteAsync("Readable", "body");

        var found = await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}");
        Assert.Equal("Readable", found!.Title);

        var missing = await _client.GetAsync($"/api/notes/{Guid.NewGuid()}");
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
    }

    [Fact]
    public async Task Update_with_current_version_bumps_version()
    {
        var created = await CreateNoteAsync();

        var response = await _client.PutAsJsonAsync(
            $"/api/notes/{created.Id}", new UpdateNoteRequest("New title", "New body", created.Version));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var updated = await response.Content.ReadFromJsonAsync<NoteDto>();
        Assert.Equal("New title", updated!.Title);
        Assert.Equal(created.Version + 1, updated.Version);
        Assert.True(updated.UpdatedAt > created.UpdatedAt);
    }

    [Fact]
    public async Task Update_with_stale_version_returns_409_and_keeps_data()
    {
        var created = await CreateNoteAsync("Original", "body");
        await _client.PutAsJsonAsync(
            $"/api/notes/{created.Id}", new UpdateNoteRequest("First edit", "body", created.Version));

        // Second client still holds version 1 -> conflict.
        var stale = await _client.PutAsJsonAsync(
            $"/api/notes/{created.Id}", new UpdateNoteRequest("Stale edit", "body", created.Version));

        Assert.Equal(HttpStatusCode.Conflict, stale.StatusCode);
        var current = await _client.GetFromJsonAsync<NoteDto>($"/api/notes/{created.Id}");
        Assert.Equal("First edit", current!.Title);
    }

    [Fact]
    public async Task Update_unknown_note_returns_404()
    {
        var response = await _client.PutAsJsonAsync(
            $"/api/notes/{Guid.NewGuid()}", new UpdateNoteRequest("t", "c", 1));

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Fact]
    public async Task Delete_is_soft_hides_note_but_keeps_the_row()
    {
        var created = await CreateNoteAsync("To delete");

        var delete = await _client.DeleteAsync($"/api/notes/{created.Id}");
        Assert.Equal(HttpStatusCode.NoContent, delete.StatusCode);

        // Hidden from the API...
        var get = await _client.GetAsync($"/api/notes/{created.Id}");
        Assert.Equal(HttpStatusCode.NotFound, get.StatusCode);
        var list = await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes");
        Assert.DoesNotContain(list!, n => n.Id == created.Id);

        // ...but still in the database, flagged as deleted (IgnoreQueryFilters bypasses the filter).
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var row = await db.Notes.IgnoreQueryFilters().SingleAsync(n => n.Id == created.Id);
        Assert.True(row.IsDeleted);
    }

    [Fact]
    public async Task List_is_ordered_by_most_recently_updated_first()
    {
        var first = await CreateNoteAsync("First");
        var second = await CreateNoteAsync("Second");
        await _client.PutAsJsonAsync(
            $"/api/notes/{first.Id}", new UpdateNoteRequest("First (edited)", "c", first.Version));

        var list = await _client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes");

        var ids = list!.Select(n => n.Id).ToList();
        Assert.True(ids.IndexOf(first.Id) < ids.IndexOf(second.Id));
    }
}
