using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using InkNote.Api.Modules.Notes.Application;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Sync.Contracts;

namespace InkNote.Api.Tests;

/// <summary>Helpers for the history of a note.</summary>
public abstract class RevisionTestBase(ApiFixture api) : SyncTestBase(api)
{
    protected async Task<NoteDto> EditAsync(Guid id, string title, string content, HttpClient? client = null)
    {
        var http = client ?? Client;
        var current = (await http.GetFromJsonAsync<NoteDto>($"/api/notes/{id}"))!;
        var response = await http.PutAsJsonAsync($"/api/notes/{id}", new UpdateNoteRequest(title, content, current.Version));
        response.EnsureSuccessStatusCode();
        return (await response.Content.ReadFromJsonAsync<NoteDto>())!;
    }

    protected async Task<List<NoteRevisionSummaryDto>> HistoryAsync(Guid id, HttpClient? client = null) =>
        (await (client ?? Client).GetFromJsonAsync<List<NoteRevisionSummaryDto>>($"/api/notes/{id}/revisions"))!;

    protected async Task<NoteRevisionDto> FullAsync(Guid noteId, Guid revisionId, HttpClient? client = null) =>
        (await (client ?? Client).GetFromJsonAsync<NoteRevisionDto>($"/api/notes/{noteId}/revisions/{revisionId}"))!;

    protected async Task<HttpResponseMessage> RestoreAsync(Guid noteId, Guid revisionId, HttpClient? client = null) =>
        await (client ?? Client).PostAsync($"/api/notes/{noteId}/revisions/{revisionId}/restore", null);

    protected async Task<NoteDto> CurrentAsync(Guid id, HttpClient? client = null) =>
        (await (client ?? Client).GetFromJsonAsync<NoteDto>($"/api/notes/{id}"))!;

    /// <summary>
    /// A note with ONE revision, made WITHOUT waiting for the age rule: another device overwrites the text with a stale
    /// base, so the server keeps the text that lost as a "conflict" revision.
    /// The revision holds ("Report v2", "edited text"); the note now holds ("Phone title", "phone text").
    /// </summary>
    protected async Task<(NoteDto Note, NoteRevisionSummaryDto Revision)> NoteWithOneRevisionAsync()
    {
        var note = await RestCreateNoteAsync("Report", "original");
        await EditAsync(note.Id, "Report v2", "edited text");
        var result = await PushOneAsync(Upsert("note", note.Id, new { title = "Phone title", content = "phone text" }, baseVersion: note.Version));
        Assert.Equal(SyncStatuses.Conflict, result.Status);
        return (note, (await HistoryAsync(note.Id)).Single());
    }
}

/// <summary>
/// WHEN the history gets a text, with the default settings: one snapshot per note per 10 minutes, counted from the last
/// snapshot or from the note's creation. A note that was just made is therefore still in its first session.
/// </summary>
public sealed class NoteRevisionPolicyTests(ApiFixture api) : RevisionTestBase(api), IClassFixture<ApiFixture>
{
    [Fact]
    public async Task The_first_minutes_of_a_new_note_make_no_snapshots_however_often_it_is_saved()
    {
        var note = await RestCreateNoteAsync("Fresh", "first words");

        await EditAsync(note.Id, "Fresh", "first words and more");
        await EditAsync(note.Id, "Fresh", "first words and more and more");
        await PushOneAsync(Upsert("note", note.Id, new { content = "and from the phone" }, baseVersion: (await CurrentAsync(note.Id)).Version));

        Assert.Empty(await HistoryAsync(note.Id));
    }

    [Fact]
    public async Task A_conflict_still_makes_its_revision_on_a_young_note()
    {
        var (_, revision) = await NoteWithOneRevisionAsync();

        Assert.Equal(NoteRevision.ConflictReason, revision.Reason);
    }

    [Fact]
    public async Task The_list_gives_summaries_a_short_beginning_and_the_length_never_the_whole_text()
    {
        var longText = string.Concat(Enumerable.Repeat("0123456789", 100)); // 1000 characters
        var note = await RestCreateNoteAsync("Long", "x");
        await EditAsync(note.Id, "Long", longText);
        await PushOneAsync(Upsert("note", note.Id, new { content = "from the phone" }, baseVersion: note.Version)); // conflict: keeps longText

        var json = await Client.GetStringAsync($"/api/notes/{note.Id}/revisions");

        using var document = JsonDocument.Parse(json);
        var item = document.RootElement.EnumerateArray().Single();
        Assert.False(item.TryGetProperty("content", out _)); // the whole text is not in the list
        Assert.Equal(1000, item.GetProperty("contentLength").GetInt32());
        Assert.Equal(longText[..200], item.GetProperty("preview").GetString());
    }

    [Fact]
    public async Task A_short_text_is_its_own_preview()
    {
        var (_, revision) = await NoteWithOneRevisionAsync();

        Assert.Equal("edited text", revision.Preview);
        Assert.Equal("edited text".Length, revision.ContentLength);
        Assert.Equal("Report v2", revision.Title);
    }

    [Fact]
    public async Task The_detail_gives_the_whole_text_and_the_version_it_had()
    {
        var (note, revision) = await NoteWithOneRevisionAsync();

        var full = await FullAsync(note.Id, revision.Id);

        Assert.Equal("edited text", full.Content);
        Assert.Equal("Report v2", full.Title);
        Assert.Equal(revision.NoteVersion, full.NoteVersion);
    }

    [Fact]
    public async Task The_list_is_newest_first()
    {
        var (note, first) = await NoteWithOneRevisionAsync();
        var current = await CurrentAsync(note.Id);
        await PushOneAsync(Upsert("note", note.Id, new { content = "another phone text" }, baseVersion: current.Version - 1)); // stale again: a second conflict

        var history = await HistoryAsync(note.Id);

        Assert.Equal(2, history.Count);
        Assert.True(history[0].CreatedAt >= history[1].CreatedAt);
        Assert.Equal(first.Id, history[1].Id); // the older one is last
    }

    [Fact]
    public async Task A_note_with_no_history_has_an_empty_list_and_an_unknown_note_is_a_404()
    {
        var note = await RestCreateNoteAsync("Fresh", "text");

        Assert.Empty(await HistoryAsync(note.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{Guid.NewGuid()}/revisions")).StatusCode);
    }
}

/// <summary>A snapshot after 1 second, so that "the note is old enough" can be tested without waiting 10 minutes.</summary>
public sealed class RevisionAgedFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Notes:Revisions:Interval"] = "00:00:01",
    };
}

public sealed class NoteRevisionAgeTests(RevisionAgedFixture api) : RevisionTestBase(api), IClassFixture<RevisionAgedFixture>
{
    /// <summary>A note that is already old enough for a snapshot.</summary>
    private async Task<NoteDto> AgedNoteAsync(string title, string content)
    {
        var note = await RestCreateNoteAsync(title, content);
        await Task.Delay(1150);
        return note;
    }

    [Fact]
    public async Task The_first_edit_of_an_old_enough_note_saves_the_text_as_it_was()
    {
        var note = await AgedNoteAsync("Plan", "first draft");

        await EditAsync(note.Id, "Plan", "second draft");

        var revision = Assert.Single(await HistoryAsync(note.Id));
        Assert.Equal(NoteRevision.EditReason, revision.Reason);
        var full = await FullAsync(note.Id, revision.Id);
        Assert.Equal("first draft", full.Content); // the text BEFORE the edit, not the new one
        Assert.Equal("Plan", full.Title);
        Assert.Equal(note.Version, full.NoteVersion);
    }

    [Fact]
    public async Task A_note_with_no_text_has_nothing_to_go_back_to_so_nothing_is_saved()
    {
        var note = await AgedNoteAsync("Untitled", "");

        await EditAsync(note.Id, "Untitled", "now it has text");

        Assert.Empty(await HistoryAsync(note.Id));
    }

    [Fact]
    public async Task Further_edits_in_the_same_session_do_not_add_snapshots()
    {
        var note = await AgedNoteAsync("Session", "v1");

        await EditAsync(note.Id, "Session", "v2");
        await EditAsync(note.Id, "Session", "v3");
        await EditAsync(note.Id, "Session", "v4");

        var revision = Assert.Single(await HistoryAsync(note.Id)); // one snapshot per editing session, not one per save
        Assert.Equal("v1", (await FullAsync(note.Id, revision.Id)).Content);
    }

    [Fact]
    public async Task After_the_interval_the_next_edit_makes_a_new_snapshot_of_the_text_at_that_moment()
    {
        var note = await AgedNoteAsync("Sessions", "v1");
        await EditAsync(note.Id, "Sessions", "v2"); // snapshot of v1
        await Task.Delay(1150);

        await EditAsync(note.Id, "Sessions", "v3"); // snapshot of v2

        var history = await HistoryAsync(note.Id);
        Assert.Equal(2, history.Count);
        Assert.Equal("v2", (await FullAsync(note.Id, history[0].Id)).Content);
        Assert.Equal("v1", (await FullAsync(note.Id, history[1].Id)).Content);
    }

    [Fact]
    public async Task A_change_that_does_not_change_the_text_saves_nothing()
    {
        var note = await AgedNoteAsync("Same", "unchanged");

        await EditAsync(note.Id, "Same", "unchanged");

        Assert.Empty(await HistoryAsync(note.Id));
    }

    [Fact]
    public async Task A_new_title_alone_counts_as_a_change_of_the_text()
    {
        var note = await AgedNoteAsync("Old title", "body");

        await EditAsync(note.Id, "New title", "body");

        var revision = Assert.Single(await HistoryAsync(note.Id));
        Assert.Equal("Old title", revision.Title);
    }

    [Fact]
    public async Task Pinning_moving_or_tagging_a_note_is_not_an_edit_of_its_text()
    {
        var note = await AgedNoteAsync("Organized", "body");

        var response = await Client.PutAsJsonAsync($"/api/notes/{note.Id}/organization", new UpdateNoteOrganizationRequest(null, true, NoteStatus.Active, [], note.Version));
        response.EnsureSuccessStatusCode();

        Assert.Empty(await HistoryAsync(note.Id));
    }

    // ---- through the synchronization ----

    [Fact]
    public async Task A_change_pushed_by_a_device_saves_the_text_as_it_was_too()
    {
        var note = await AgedNoteAsync("Synced", "text on the server");

        var result = await PushOneAsync(Upsert("note", note.Id, new { content = "text from the phone" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Applied, result.Status);
        var revision = Assert.Single(await HistoryAsync(note.Id));
        Assert.Equal(NoteRevision.EditReason, revision.Reason);
        Assert.Equal("text on the server", (await FullAsync(note.Id, revision.Id)).Content);
    }

    [Fact]
    public async Task The_throttle_is_shared_by_the_REST_API_and_the_synchronization()
    {
        var note = await AgedNoteAsync("Shared", "v1");
        var edited = await EditAsync(note.Id, "Shared", "v2"); // snapshot of v1

        await PushOneAsync(Upsert("note", note.Id, new { content = "v3" }, baseVersion: edited.Version));
        await EditAsync(note.Id, "Shared", "v4");

        Assert.Single(await HistoryAsync(note.Id));
    }

    [Fact]
    public async Task A_conflict_makes_ONE_revision_not_a_conflict_one_and_an_edit_one()
    {
        var note = await AgedNoteAsync("Both", "original"); // old enough: an edit WOULD make a snapshot
        await Client.PutAsJsonAsync($"/api/notes/{note.Id}/organization", new UpdateNoteOrganizationRequest(null, true, NoteStatus.None, [], note.Version)); // the server moves on; no snapshot

        // The other device still thinks the note is at the old version and overwrites the text.
        var result = await PushOneAsync(Upsert("note", note.Id, new { content = "typed on the phone" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Conflict, result.Status);
        var revision = Assert.Single(await HistoryAsync(note.Id)); // not two copies of the same text
        Assert.Equal(NoteRevision.ConflictReason, revision.Reason);
    }
}

/// <summary>Putting an older text back.</summary>
public sealed class NoteRevisionRestoreTests(ApiFixture api) : RevisionTestBase(api), IClassFixture<ApiFixture>
{
    [Fact]
    public async Task Restoring_puts_the_old_title_and_text_back_and_answers_with_the_note()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        var before = await CurrentAsync(note.Id);
        Assert.Equal("phone text", before.Content);

        var response = await RestoreAsync(note.Id, old.Id);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var restored = (await response.Content.ReadFromJsonAsync<NoteDto>())!;
        Assert.Equal("Report v2", restored.Title);
        Assert.Equal("edited text", restored.Content);
        var stored = await CurrentAsync(note.Id);
        Assert.Equal("edited text", stored.Content);
        Assert.True(stored.Version > before.Version); // a normal edit as far as the other devices are concerned
    }

    [Fact]
    public async Task The_text_that_was_replaced_is_saved_first_so_a_restore_can_be_undone()
    {
        var (note, old) = await NoteWithOneRevisionAsync();

        await RestoreAsync(note.Id, old.Id);

        var history = await HistoryAsync(note.Id);
        var undo = Assert.Single(history, h => h.Reason == NoteRevision.RestoreReason);
        var replaced = await FullAsync(note.Id, undo.Id);
        Assert.Equal("phone text", replaced.Content);
        Assert.Equal("Phone title", replaced.Title);

        await RestoreAsync(note.Id, undo.Id); // go forward again
        Assert.Equal("phone text", (await CurrentAsync(note.Id)).Content);
    }

    [Fact]
    public async Task A_restore_is_always_saved_the_age_rule_does_not_apply_to_it()
    {
        var (note, old) = await NoteWithOneRevisionAsync(); // a revision exists from a moment ago

        await RestoreAsync(note.Id, old.Id);

        Assert.Equal(2, (await HistoryAsync(note.Id)).Count);
    }

    [Fact]
    public async Task Restoring_the_text_the_note_already_has_changes_nothing()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        await RestoreAsync(note.Id, old.Id); // now the note HAS that text
        var before = await CurrentAsync(note.Id);
        var count = (await HistoryAsync(note.Id)).Count;

        var again = await RestoreAsync(note.Id, old.Id);

        Assert.Equal(HttpStatusCode.OK, again.StatusCode);
        Assert.Equal(before.Version, (await CurrentAsync(note.Id)).Version);
        Assert.Equal(count, (await HistoryAsync(note.Id)).Count);
    }

    [Fact]
    public async Task Restoring_leaves_the_notebook_the_pin_the_status_and_the_tags_alone()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        var tag = await (await Client.PostAsJsonAsync("/api/tags", new { name = "keep-" + Guid.NewGuid().ToString("N")[..6] })).Content.ReadFromJsonAsync<JsonElement>();
        var tagId = tag.GetProperty("id").GetGuid();
        var current = await CurrentAsync(note.Id);
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}/organization", new UpdateNoteOrganizationRequest(null, true, NoteStatus.Active, [tagId], current.Version))).EnsureSuccessStatusCode();

        await RestoreAsync(note.Id, old.Id);

        var after = await CurrentAsync(note.Id);
        Assert.True(after.IsPinned);
        Assert.Equal(NoteStatus.Active, after.Status);
        Assert.Equal([tagId], after.TagIds);
    }

    [Fact]
    public async Task The_restored_note_reaches_the_other_devices_through_the_normal_pull()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        var cursor = (await PullAsync()).Cursor;

        await RestoreAsync(note.Id, old.Id);

        var (changes, _) = await PullAllAsync(cursor);
        var change = Assert.Single(changes, c => c.Id == note.Id);
        Assert.Equal("edited text", Str(change.Data, "content"));
    }

    // ---- who may do it ----

    [Fact]
    public async Task Another_user_cannot_list_read_or_restore_the_history_of_a_note_that_is_not_theirs()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        var other = Api.CreateUserClient();

        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/notes/{note.Id}/revisions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await other.GetAsync($"/api/notes/{note.Id}/revisions/{old.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(note.Id, old.Id, other)).StatusCode);
        Assert.Equal("phone text", (await CurrentAsync(note.Id)).Content); // nothing changed
    }

    [Fact]
    public async Task A_revision_is_only_reachable_through_its_own_note()
    {
        var (_, old) = await NoteWithOneRevisionAsync();
        var otherNote = await RestCreateNoteAsync("Other", "other text");

        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{otherNote.Id}/revisions/{old.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(otherNote.Id, old.Id)).StatusCode);
        Assert.Equal("other text", (await CurrentAsync(otherNote.Id)).Content); // the text of another note never moves across
    }

    [Fact]
    public async Task Unknown_ids_are_404()
    {
        var (note, _) = await NoteWithOneRevisionAsync();

        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{note.Id}/revisions/{Guid.NewGuid()}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(note.Id, Guid.NewGuid())).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(Guid.NewGuid(), Guid.NewGuid())).StatusCode);
    }

    [Fact]
    public async Task A_note_in_the_trash_cannot_be_put_back_to_an_older_text_restore_the_note_first()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        (await Client.DeleteAsync($"/api/notes/{note.Id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.OK, (await Client.GetAsync($"/api/notes/{note.Id}/revisions/{old.Id}")).StatusCode); // it can be read
        Assert.Equal(HttpStatusCode.NotFound, (await RestoreAsync(note.Id, old.Id)).StatusCode);
    }

    [Fact]
    public async Task Deleting_a_note_for_good_deletes_its_history()
    {
        var (note, old) = await NoteWithOneRevisionAsync();
        (await Client.DeleteAsync($"/api/notes/{note.Id}")).EnsureSuccessStatusCode();

        (await Client.DeleteAsync($"/api/notes/trash/{note.Id}")).EnsureSuccessStatusCode();

        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{note.Id}/revisions/{old.Id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{note.Id}/revisions")).StatusCode);
    }
}

/// <summary>A snapshot on EVERY edit, and only three kept: to see the cap at work.</summary>
public sealed class RevisionLimitsFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?>
    {
        ["Notes:Revisions:Interval"] = "00:00:00",
        ["Notes:Revisions:MaxPerNote"] = "3",
    };
}

public sealed class NoteRevisionLimitTests(RevisionLimitsFixture api) : RevisionTestBase(api), IClassFixture<RevisionLimitsFixture>
{
    [Fact]
    public async Task Only_the_newest_snapshots_are_kept_the_oldest_go_first()
    {
        var note = await RestCreateNoteAsync("Capped", "v1");
        for (var i = 2; i <= 7; i++)
        {
            await EditAsync(note.Id, "Capped", $"v{i}"); // each edit snapshots the text before it: v1 .. v6
        }

        var history = await HistoryAsync(note.Id);

        Assert.Equal(3, history.Count);
        var texts = new List<string>();
        foreach (var revision in history)
        {
            texts.Add((await FullAsync(note.Id, revision.Id)).Content);
        }

        Assert.Equal(["v6", "v5", "v4"], texts); // newest first; v1, v2, v3 were dropped
    }

    [Fact]
    public async Task The_cap_is_per_note_another_notes_history_is_untouched()
    {
        var capped = await RestCreateNoteAsync("Many", "v1");
        var untouched = await RestCreateNoteAsync("Quiet", "q1");
        await EditAsync(untouched.Id, "Quiet", "q2");

        for (var i = 2; i <= 6; i++)
        {
            await EditAsync(capped.Id, "Many", $"v{i}");
        }

        Assert.Equal(3, (await HistoryAsync(capped.Id)).Count);
        Assert.Single(await HistoryAsync(untouched.Id));
    }

    [Fact]
    public async Task A_restore_also_respects_the_cap()
    {
        var note = await RestCreateNoteAsync("Restored", "v1");
        for (var i = 2; i <= 5; i++)
        {
            await EditAsync(note.Id, "Restored", $"v{i}");
        }

        var oldest = (await HistoryAsync(note.Id)).Last(); // the oldest one that is left
        await RestoreAsync(note.Id, oldest.Id);

        Assert.Equal(3, (await HistoryAsync(note.Id)).Count);
    }
}
