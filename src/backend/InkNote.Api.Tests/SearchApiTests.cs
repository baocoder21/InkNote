using System.Data;
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

/// <summary>Full-text search: what matches, how it is ranked, and what must never show up.</summary>
public sealed class SearchApiTests(ApiFixture api) : IClassFixture<ApiFixture>
{
    private readonly HttpClient _client = api.CreateUserClient();

    // Every test uses its own random "topic" word, so notes of other tests (same user, same database)
    // can never match by accident.
    private static string Topic() => "zq" + Guid.NewGuid().ToString("N")[..10];

    private async Task<NoteDto> CreateAsync(string title, string content = "", HttpClient? client = null)
    {
        var response = await (client ?? _client).PostAsJsonAsync("/api/notes", new CreateNoteRequest(title, content));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }

    private async Task<SearchResponse> SearchAsync(string q, string extra = "", HttpClient? client = null)
    {
        var response = await (client ?? _client).GetAsync($"/api/notes/search?q={Uri.EscapeDataString(q)}{extra}");
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<SearchResponse>())!;
    }

    private async Task<IReadOnlyList<Guid>> IdsAsync(string q, string extra = "") =>
        (await SearchAsync(q, extra)).Items.Select(i => i.Id).ToList();

    private static string Marked(IEnumerable<TextPart> parts) =>
        string.Concat(parts.Select(p => p.Match ? $"[{p.Text}]" : p.Text));

    // ---------- what matches ----------

    [Fact]
    public async Task Finds_a_word_in_the_title_and_a_word_in_the_content()
    {
        var topic = Topic();
        var inTitle = await CreateAsync($"Report {topic}", "nothing special");
        var inContent = await CreateAsync("Plain title", $"the body mentions {topic} once");
        var unrelated = await CreateAsync("Other", "other");

        var ids = await IdsAsync(topic);

        Assert.Contains(inTitle.Id, ids);
        Assert.Contains(inContent.Id, ids);
        Assert.DoesNotContain(unrelated.Id, ids);
    }

    [Fact]
    public async Task Ignores_case()
    {
        var topic = Topic();
        var note = await CreateAsync($"Quarterly {topic.ToUpperInvariant()}");

        Assert.Contains(note.Id, await IdsAsync(topic.ToLowerInvariant()));
    }

    [Theory]
    [InlineData("chao")]
    [InlineData("CHÀO")]
    [InlineData("duong")]
    [InlineData("đường")]
    [InlineData("dong khoi")]
    [InlineData("Đồng Khởi")]
    public async Task Ignores_accents_in_both_directions_for_Vietnamese(string query)
    {
        var topic = Topic();
        var note = await CreateAsync($"Ghi chú {topic}", "Xin chào, đường Đồng Khởi rất đẹp");

        var ids = await IdsAsync($"{topic} {query}");

        Assert.Contains(note.Id, ids);
    }

    [Fact]
    public async Task A_query_with_accents_finds_text_written_without_accents()
    {
        var topic = Topic();
        var note = await CreateAsync($"No accents {topic}", "cafe nhan ho tro");

        Assert.Contains(note.Id, await IdsAsync($"{topic} café"));
        Assert.Contains(note.Id, await IdsAsync($"{topic} hỗ trợ"));
    }

    [Fact]
    public async Task Matches_the_beginning_of_words_as_you_type()
    {
        var topic = Topic();
        var note = await CreateAsync($"Guide {topic}programming", "x");

        Assert.Contains(note.Id, await IdsAsync($"{topic}prog"));
        Assert.Contains(note.Id, await IdsAsync($"{topic}programming"));
    }

    [Fact]
    public async Task Every_word_of_the_query_must_match()
    {
        var topic = Topic();
        var both = await CreateAsync($"{topic} alpha beta");
        var onlyAlpha = await CreateAsync($"{topic} alpha gamma");

        var ids = await IdsAsync($"{topic} alpha beta");

        Assert.Contains(both.Id, ids);
        Assert.DoesNotContain(onlyAlpha.Id, ids);
    }

    // ---------- typos ----------

    [Theory]
    [InlineData("meting", "Weekly meeting notes")]            // a letter missing
    [InlineData("progamming", "Intro to programming")]        // a letter missing
    [InlineData("kubernetes", "Notes about kubernets cluster")] // a letter missing in the TEXT
    [InlineData("organisation", "Our organization plan")]      // s / z
    public async Task A_small_typo_in_a_longer_word_still_finds_the_note(string query, string text)
    {
        var topic = Topic();
        var inTitle = await CreateAsync(text + " " + topic);
        var inContent = await CreateAsync($"Plain {topic}", text);

        var ids = await IdsAsync(query, $"&pageSize=50");

        Assert.Contains(inTitle.Id, ids);
        Assert.Contains(inContent.Id, ids);
    }

    [Fact]
    public async Task Typo_tolerance_does_not_turn_into_matching_everything()
    {
        var topic = Topic();
        await CreateAsync($"Completely different text {topic}");

        var result = await SearchAsync("xyzabc");

        Assert.Empty(result.Items);
    }

    // ---------- ranking ----------

    [Fact]
    public async Task A_hit_in_the_title_ranks_above_a_hit_in_the_content()
    {
        var topic = Topic();
        var contentOnly = await CreateAsync("Miscellaneous", $"{topic} {topic} {topic}"); // even three times
        var titleHit = await CreateAsync($"About {topic}", "short");

        var ids = await IdsAsync(topic);

        Assert.True(ids.ToList().IndexOf(titleHit.Id) < ids.ToList().IndexOf(contentOnly.Id));
    }

    [Fact]
    public async Task Equally_relevant_notes_come_most_recently_edited_first()
    {
        var topic = Topic();
        var older = await CreateAsync($"{topic} same");
        await Task.Delay(30);
        var newer = await CreateAsync($"{topic} same");

        var ids = (await IdsAsync(topic)).ToList();

        Assert.True(ids.IndexOf(newer.Id) < ids.IndexOf(older.Id));
    }

    // ---------- the answer ----------

    [Fact]
    public async Task Marks_the_matching_words_in_the_title_and_cuts_a_snippet_with_accents_intact()
    {
        var topic = Topic();
        await CreateAsync($"Xin chào {topic}", "Hôm nay trời đẹp. Đường Đồng Khởi rất đông người, xin chào mọi người.");

        var item = (await SearchAsync($"{topic} chao duong")).Items.Single();

        Assert.Equal($"Xin [chào] [{topic}]", Marked(item.Title));
        Assert.Contains("[Đường]", Marked(item.Snippet));
        Assert.Contains("[chào]", Marked(item.Snippet));
    }

    [Fact]
    public async Task The_result_carries_what_the_sidebar_needs_to_show_it()
    {
        var topic = Topic();
        var notebook = (await (await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Search folder", null))).Content.ReadFromJsonAsync<NotebookDto>())!;
        var tag = (await (await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"tag-{Guid.NewGuid():N}"))).Content.ReadFromJsonAsync<TagDto>())!;
        var created = await CreateAsync($"Full {topic}", "text");
        (await _client.PutAsJsonAsync($"/api/notes/{created.Id}/organization",
            new UpdateNoteOrganizationRequest(notebook.Id, true, NoteStatus.Active, [tag.Id], created.Version))).EnsureSuccessStatusCode();

        var item = (await SearchAsync(topic)).Items.Single();

        Assert.Equal(created.Id, item.Id);
        Assert.Equal(notebook.Id, item.NotebookId);
        Assert.True(item.IsPinned);
        Assert.Equal(NoteStatus.Active, item.Status);
        Assert.Equal([tag.Id], item.TagIds);
    }

    [Fact]
    public async Task Markup_in_a_note_comes_back_as_plain_text_never_as_html()
    {
        var topic = Topic();
        await CreateAsync($"XSS {topic}", "<script>alert('x')</script> and <img src=x onerror=alert(1)>");

        var item = (await SearchAsync($"{topic} script")).Items.Single();
        var snippet = string.Concat(item.Snippet.Select(p => p.Text));

        // Plain strings: the front end shows them as text (no innerHTML), so this cannot run.
        Assert.Contains("<script>", snippet);
        Assert.Equal("<[script]>alert('x')</[script]> and <img src=x onerror=alert(1)>", Marked(item.Snippet));
    }

    [Fact]
    public async Task A_match_deep_inside_a_long_note_is_found_and_shown_in_the_snippet()
    {
        var topic = Topic();
        var filler = string.Join(' ', Enumerable.Repeat("lorem ipsum dolor sit amet", 400)); // ~10,000 characters
        var note = await CreateAsync($"Long {topic}", $"{filler} deepword {filler}");

        var item = (await SearchAsync("deepword", $"&pageSize=50")).Items.Single(i => i.Id == note.Id);

        Assert.Contains("[deepword]", Marked(item.Snippet));
        Assert.Equal("…", item.Snippet[0].Text);
    }

    [Fact]
    public async Task A_note_with_no_matching_content_still_shows_a_snippet_from_its_start()
    {
        var topic = Topic();
        await CreateAsync($"Only the title has {topic}", "This is the beginning of the content.");

        var item = (await SearchAsync(topic)).Items.Single();

        Assert.Equal("This is the beginning of the content.", Marked(item.Snippet));
    }

    // ---------- empty and odd queries ----------

    [Fact]
    public async Task No_match_is_an_empty_list_not_an_error()
    {
        var result = await SearchAsync("zqnothingwillmatchthis");

        Assert.Empty(result.Items);
        Assert.Equal(0, result.Total);
    }

    [Theory]
    [InlineData("!!!")]
    [InlineData("& | ! ( ) : * '")]
    [InlineData("a & b | !c (d) e:* f'")]
    [InlineData("'; DROP TABLE notes; --")]
    [InlineData("\\")]
    [InlineData("<script>alert(1)</script>")]
    [InlineData("a b c d e f g h i j k l m n o p q r s t")]
    public async Task Odd_queries_are_harmless_answers_never_errors_and_never_damage_anything(string query)
    {
        var topic = Topic();
        var note = await CreateAsync($"Survivor {topic}");

        var response = await _client.GetAsync($"/api/notes/search?q={Uri.EscapeDataString(query)}");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains(note.Id, await IdsAsync(topic)); // the table is still there, the note is still found
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("&page=1")] // no q at all
    public async Task A_missing_or_blank_query_is_a_400(string q)
    {
        var url = q.StartsWith('&') ? $"/api/notes/search?{q.TrimStart('&')}" : $"/api/notes/search?q={Uri.EscapeDataString(q)}";

        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync(url)).StatusCode);
    }

    [Fact]
    public async Task A_query_longer_than_100_characters_is_a_400()
    {
        var ok = await _client.GetAsync($"/api/notes/search?q={new string('a', 100)}");
        var tooLong = await _client.GetAsync($"/api/notes/search?q={new string('a', 101)}");

        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    [Theory]
    [InlineData("&page=0")]
    [InlineData("&page=-1")]
    [InlineData("&pageSize=0")]
    [InlineData("&pageSize=51")]
    public async Task Bad_paging_values_are_a_400(string extra)
    {
        Assert.Equal(HttpStatusCode.BadRequest, (await _client.GetAsync($"/api/notes/search?q=a{extra}")).StatusCode);
    }

    // ---------- paging ----------

    [Fact]
    public async Task Pages_cover_every_result_once_and_report_the_total()
    {
        var topic = Topic();
        var created = new List<Guid>();
        for (var i = 0; i < 5; i++)
        {
            created.Add((await CreateAsync($"{topic} number {i}")).Id);
        }

        var first = await SearchAsync(topic, "&page=1&pageSize=2");
        var second = await SearchAsync(topic, "&page=2&pageSize=2");
        var third = await SearchAsync(topic, "&page=3&pageSize=2");
        var beyond = await SearchAsync(topic, "&page=4&pageSize=2");

        Assert.Equal(5, first.Total);
        Assert.Equal([2, 2, 1, 0], [first.Items.Count, second.Items.Count, third.Items.Count, beyond.Items.Count]);
        Assert.Equal(5, beyond.Total); // the total does not depend on the page
        var all = first.Items.Concat(second.Items).Concat(third.Items).Select(i => i.Id).ToList();
        Assert.Equal(5, all.Distinct().Count());                  // no note twice
        Assert.True(created.All(all.Contains));                    // none lost
        Assert.Equal(2, first.PageSize);
    }

    [Fact]
    public async Task The_default_page_size_is_20()
    {
        var topic = Topic();
        for (var i = 0; i < 22; i++)
        {
            await CreateAsync($"{topic} item {i}");
        }

        var result = await SearchAsync(topic);

        Assert.Equal(22, result.Total);
        Assert.Equal(20, result.Items.Count);
        Assert.Equal(20, result.PageSize);
    }

    // ---------- filters ----------

    [Fact]
    public async Task Can_be_limited_to_a_notebook_or_a_tag()
    {
        var topic = Topic();
        var notebook = (await (await _client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Filter folder", null))).Content.ReadFromJsonAsync<NotebookDto>())!;
        var tag = (await (await _client.PostAsJsonAsync("/api/tags", new CreateTagRequest($"tag-{Guid.NewGuid():N}"))).Content.ReadFromJsonAsync<TagDto>())!;
        var inFolder = (await (await _client.PostAsJsonAsync("/api/notes", new CreateNoteRequest($"{topic} in folder", "x", notebook.Id))).Content.ReadFromJsonAsync<NoteDto>())!;
        var tagged = await CreateAsync($"{topic} tagged");
        (await _client.PutAsJsonAsync($"/api/notes/{tagged.Id}/organization",
            new UpdateNoteOrganizationRequest(null, false, NoteStatus.None, [tag.Id], tagged.Version))).EnsureSuccessStatusCode();
        var loose = await CreateAsync($"{topic} loose");

        Assert.Equal([inFolder.Id], await IdsAsync(topic, $"&notebookId={notebook.Id}"));
        Assert.Equal([tagged.Id], await IdsAsync(topic, $"&tagId={tag.Id}"));
        Assert.Contains(loose.Id, await IdsAsync(topic)); // without a filter, all three
        Assert.Equal(3, (await SearchAsync(topic)).Total);
    }

    // ---------- the index follows the note ----------

    [Fact]
    public async Task Editing_a_note_updates_what_can_be_found_at_once()
    {
        // Two UNRELATED words. (A shared tail made them similar to each other: with typo tolerance "beforeX"
        // still finds a note that now says "afterX", which is correct behavior but not what this test is about.)
        var (before, after) = (Topic(), Topic());
        var note = await CreateAsync("Draft", before);
        Assert.Contains(note.Id, await IdsAsync(before));

        (await _client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Draft", after, note.Version))).EnsureSuccessStatusCode();

        Assert.DoesNotContain(note.Id, await IdsAsync(before)); // the generated column was recomputed by the database
        Assert.Contains(note.Id, await IdsAsync(after));
    }

    [Fact]
    public async Task Deleted_notes_are_not_found_and_come_back_when_restored()
    {
        var topic = Topic();
        var note = await CreateAsync($"Temporary {topic}");

        await _client.DeleteAsync($"/api/notes/{note.Id}");
        Assert.DoesNotContain(note.Id, await IdsAsync(topic));

        await _client.PostAsync($"/api/notes/trash/{note.Id}/restore", null);
        Assert.Contains(note.Id, await IdsAsync(topic));
    }

    // ---------- other users ----------

    [Fact]
    public async Task Never_returns_another_users_notes_not_even_for_an_exact_match()
    {
        var topic = Topic();
        var bob = api.CreateUserClient();
        var alicesNote = await CreateAsync($"Alice secret {topic}", $"{topic} private text");
        var bobsNote = await CreateAsync($"Bob note {topic}", "x", bob);

        var alice = await SearchAsync(topic);
        var bobResult = await SearchAsync(topic, client: bob);

        Assert.Equal([alicesNote.Id], alice.Items.Select(i => i.Id));
        Assert.Equal([bobsNote.Id], bobResult.Items.Select(i => i.Id));
        Assert.Equal(1, bobResult.Total);                     // the count does not leak either
        Assert.DoesNotContain("private", Marked(bobResult.Items.SelectMany(i => i.Snippet)));
    }

    [Fact]
    public async Task Search_needs_a_signed_in_user()
    {
        var anonymous = api.CreateAnonymousClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/notes/search?q=a")).StatusCode);
    }

    // ---------- the database side ----------

    [Fact]
    public async Task f_unaccent_handles_Vietnamese_and_is_declared_immutable()
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await using var command = db.Database.GetDbConnection().CreateCommand();
        await db.Database.OpenConnectionAsync();

        command.CommandText = "SELECT f_unaccent('Đường Đồng Khởi, Ở Ữ ế ạ')";
        Assert.Equal("Duong Dong Khoi, O U e a", await command.ExecuteScalarAsync());

        command.CommandText = "SELECT provolatile FROM pg_proc WHERE proname = 'f_unaccent'";
        Assert.Equal('i', await command.ExecuteScalarAsync()); // i = immutable: required by a generated column and by indexes
    }

    [Theory]
    [InlineData("SELECT id FROM notes WHERE search_vector @@ to_tsquery('simple', 'hello:*')", "ix_notes_search_vector")]
    [InlineData("SELECT id FROM notes WHERE 'hello' <% f_unaccent(lower(title))", "ix_notes_title_trgm")]
    [InlineData("SELECT id FROM notes WHERE 'hello' <% f_unaccent(lower(content))", "ix_notes_content_trgm")]
    public async Task The_indexes_exist_and_the_planner_can_use_them(string sql, string expectedIndex)
    {
        using var scope = api.Services.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        await db.Database.OpenConnectionAsync();
        var connection = db.Database.GetDbConnection();

        async Task RunAsync(string text)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = text;
            await command.ExecuteNonQueryAsync();
        }

        await RunAsync("BEGIN");
        try
        {
            // A near-empty test table would be read sequentially (cheaper than any index). Forbid that
            // for this check, so the plan shows whether the index COULD answer the question.
            await RunAsync("SET LOCAL enable_seqscan = off");
            await using var explain = connection.CreateCommand();
            explain.CommandText = "EXPLAIN " + sql;
            var plan = new List<string>();
            await using (var reader = await explain.ExecuteReaderAsync())
            {
                while (await reader.ReadAsync()) plan.Add(reader.GetString(0));
            }

            Assert.Contains(plan, line => line.Contains(expectedIndex, StringComparison.Ordinal));
        }
        finally
        {
            await RunAsync("ROLLBACK");
        }
    }
}
