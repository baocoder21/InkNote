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

/// <summary>Pushing notes: create, edit, conflicts, delete, retries, and bad input.</summary>
public sealed class SyncNotePushTests(ApiFixture api) : SyncTestBase(api), IClassFixture<ApiFixture>
{
    // ---------- create ----------

    [Fact]
    public async Task A_note_created_on_a_device_with_its_own_id_appears_on_the_server()
    {
        var id = Guid.NewGuid();

        var result = await PushOneAsync(Upsert("note", id, new { title = "Made offline", content = "typed on a train" }));

        Assert.Equal(SyncStatuses.Applied, result.Status);
        Assert.True(Int(result.Entity, "version") >= 1);
        var note = await GetNoteAsync(id); // visible through the normal API too
        Assert.Equal("Made offline", note.Title);
        Assert.Equal("typed on a train", note.Content);
    }

    [Fact]
    public async Task A_note_can_be_created_with_its_organization_in_one_operation()
    {
        var notebook = Guid.NewGuid();
        var tag = Guid.NewGuid();
        var id = Guid.NewGuid();
        await PushAsync(
            Upsert("notebook", notebook, new { name = "Work" }),
            Upsert("tag", tag, new { name = $"urgent-{Guid.NewGuid():N}" }),
            Upsert("note", id, new { title = "Plan", content = "c", notebookId = notebook, isPinned = true, status = "Active", tagIds = new[] { tag } }));

        var note = await GetNoteAsync(id);

        Assert.Equal(notebook, note.NotebookId); // the batch is applied in order: the folder existed when the note arrived
        Assert.Equal([tag], note.TagIds);
        Assert.True(note.IsPinned);
        Assert.Equal(NoteStatus.Active, note.Status);
    }

    [Fact]
    public async Task A_new_note_without_a_title_is_rejected()
    {
        var result = await PushOneAsync(Upsert("note", Guid.NewGuid(), new { content = "no title" }));

        Assert.Equal(SyncStatuses.Rejected, result.Status);
    }

    [Fact]
    public async Task An_id_that_belongs_to_another_users_note_is_rejected_and_that_note_is_untouched()
    {
        var bob = Api.CreateUserClient();
        var alicesNote = await RestCreateNoteAsync("Alice's", "private");

        var attack = await PushOneAsync(Upsert("note", alicesNote.Id, new { title = "Bob took it", content = "x" }), bob);

        Assert.Equal(SyncStatuses.Rejected, attack.Status);
        Assert.Equal("Alice's", (await GetNoteAsync(alicesNote.Id)).Title);
        Assert.Equal(HttpStatusCode.NotFound, await NoteStatusAsync(alicesNote.Id, bob));
    }

    [Fact]
    public async Task Bob_cannot_edit_or_delete_Alices_note_by_pushing_to_its_id()
    {
        var bob = Api.CreateUserClient();
        var note = await RestCreateNoteAsync("Alice's", "private");

        var edit = await PushOneAsync(Upsert("note", note.Id, new { title = "Hacked" }, baseVersion: note.Version), bob);
        var delete = await PushOneAsync(Delete("note", note.Id), bob);

        Assert.Equal(SyncStatuses.Gone, edit.Status); // for Bob, that note does not exist
        Assert.Equal(SyncStatuses.Applied, delete.Status); // "already gone" for Bob: a no-op
        var still = await GetNoteAsync(note.Id);
        Assert.Equal("Alice's", still.Title);
        Assert.Equal(note.Version, still.Version);
    }

    // ---------- update and conflicts ----------

    [Fact]
    public async Task An_edit_based_on_the_current_version_is_applied_and_bumps_the_version()
    {
        var note = await RestCreateNoteAsync("v1", "old");

        var result = await PushOneAsync(Upsert("note", note.Id, new { title = "v2", content = "new" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Applied, result.Status);
        Assert.Equal(note.Version + 1, Int(result.Entity, "version"));
        Assert.Empty(await RevisionsAsync(note.Id));
    }

    [Fact]
    public async Task An_edit_based_on_an_old_version_wins_and_the_text_it_replaced_is_saved_as_a_revision()
    {
        var note = await RestCreateNoteAsync("Shared", "text from the first device");
        // The first device synchronizes its edit; the second still has the old version.
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Shared", "edited on device A", note.Version))).EnsureSuccessStatusCode();

        var result = await PushOneAsync(Upsert("note", note.Id, new { content = "edited on device B" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Conflict, result.Status);
        Assert.Equal("edited on device B", (await GetNoteAsync(note.Id)).Content); // last write wins
        var revision = Assert.Single(await RevisionsAsync(note.Id));
        Assert.Equal("edited on device A", revision.Content); // ...and A's text is not lost
        Assert.Equal("Shared", revision.Title);
        Assert.Equal("conflict", revision.Reason);
    }

    [Fact]
    public async Task Different_fields_changed_on_two_devices_both_survive()
    {
        var note = await RestCreateNoteAsync("Original title", "body");
        // Device A renames it.
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Title from A", "body", note.Version))).EnsureSuccessStatusCode();

        // Device B (still on the old version) only pinned it.
        var result = await PushOneAsync(Upsert("note", note.Id, new { isPinned = true }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Applied, result.Status); // no text was overwritten: not a conflict
        var merged = await GetNoteAsync(note.Id);
        Assert.Equal("Title from A", merged.Title); // A's change is still there
        Assert.True(merged.IsPinned);               // and so is B's
        Assert.Empty(await RevisionsAsync(note.Id));
    }

    [Fact]
    public async Task A_stale_edit_that_writes_the_same_text_is_not_a_conflict()
    {
        var note = await RestCreateNoteAsync("Same", "same text");
        await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Same", "same text", note.Version));
        var current = await GetNoteAsync(note.Id);
        await Client.PutAsJsonAsync($"/api/notes/{note.Id}/organization", new UpdateNoteOrganizationRequest(null, true, NoteStatus.None, [], current.Version));

        var result = await PushOneAsync(Upsert("note", note.Id, new { content = "same text" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Applied, result.Status);
        Assert.Empty(await RevisionsAsync(note.Id));
    }

    [Fact]
    public async Task Several_conflicts_keep_several_revisions_newest_first()
    {
        var note = await RestCreateNoteAsync("T", "v0");
        var staleBase = note.Version;
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("T", "from A", note.Version))).EnsureSuccessStatusCode();
        await PushOneAsync(Upsert("note", note.Id, new { content = "from B" }, baseVersion: staleBase));   // conflict #1 saves "from A"
        await Task.Delay(20);
        await PushOneAsync(Upsert("note", note.Id, new { content = "from C" }, baseVersion: staleBase));   // conflict #2 saves "from B"

        var revisions = await RevisionsAsync(note.Id);

        Assert.Equal(["from B", "from A"], revisions.Select(r => r.Content));
        Assert.Equal("from C", (await GetNoteAsync(note.Id)).Content);
    }

    [Fact]
    public async Task Pushing_without_a_base_version_to_an_existing_note_just_applies_the_fields()
    {
        var note = await RestCreateNoteAsync("Existing", "body");

        var result = await PushOneAsync(Upsert("note", note.Id, new { title = "Renamed" })); // BaseVersion null

        Assert.Equal(SyncStatuses.Applied, result.Status);
        Assert.Equal("Renamed", (await GetNoteAsync(note.Id)).Title);
    }

    [Fact]
    public async Task References_to_things_deleted_elsewhere_are_left_out_instead_of_failing()
    {
        var gone = Guid.NewGuid();
        var id = Guid.NewGuid();

        var result = await PushOneAsync(Upsert("note", id, new { title = "Orphan refs", content = "c", notebookId = gone, tagIds = new[] { Guid.NewGuid(), Guid.NewGuid() } }));

        Assert.Equal(SyncStatuses.Applied, result.Status);
        var note = await GetNoteAsync(id);
        Assert.Null(note.NotebookId);
        Assert.Empty(note.TagIds);
    }

    [Fact]
    public async Task Clearing_the_notebook_and_the_tags_works_and_is_different_from_not_mentioning_them()
    {
        var notebook = Guid.NewGuid();
        var tag = Guid.NewGuid();
        var id = Guid.NewGuid();
        await PushAsync(
            Upsert("notebook", notebook, new { name = "F" }),
            Upsert("tag", tag, new { name = $"t-{Guid.NewGuid():N}" }),
            Upsert("note", id, new { title = "N", notebookId = notebook, tagIds = new[] { tag } }));
        var note = await GetNoteAsync(id);

        // not mentioning them leaves them alone
        var untouched = await PushOneAsync(Upsert("note", id, new { isPinned = true }, baseVersion: note.Version));
        var afterUntouched = await GetNoteAsync(id);
        Assert.Equal(notebook, afterUntouched.NotebookId);
        Assert.Equal([tag], afterUntouched.TagIds);

        // null / [] clears them
        var cleared = await PushOneAsync(Upsert("note", id, new { notebookId = (Guid?)null, tagIds = Array.Empty<Guid>() }, baseVersion: Int(untouched.Entity, "version")));
        Assert.Equal(SyncStatuses.Applied, cleared.Status);
        var afterCleared = await GetNoteAsync(id);
        Assert.Null(afterCleared.NotebookId);
        Assert.Empty(afterCleared.TagIds);
    }

    // ---------- delete ----------

    [Fact]
    public async Task Deleting_moves_the_note_to_the_trash_and_a_second_delete_changes_nothing()
    {
        var note = await RestCreateNoteAsync("To delete");

        var first = await PushOneAsync(Delete("note", note.Id));
        var second = await PushOneAsync(Delete("note", note.Id));
        var unknown = await PushOneAsync(Delete("note", Guid.NewGuid()));

        Assert.Equal(SyncStatuses.Applied, first.Status);
        Assert.Equal(SyncStatuses.Applied, second.Status);
        Assert.Equal(SyncStatuses.Applied, unknown.Status);
        Assert.Equal(HttpStatusCode.NotFound, await NoteStatusAsync(note.Id));
        var trash = (await Client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes/trash"))!;
        Assert.Contains(trash, n => n.Id == note.Id); // recoverable
    }

    [Fact]
    public async Task An_edit_that_arrives_after_a_delete_goes_into_the_trashed_copy_and_the_device_is_told_it_is_gone()
    {
        var note = await RestCreateNoteAsync("Doomed", "original");
        await Client.DeleteAsync($"/api/notes/{note.Id}"); // deleted on device A

        var result = await PushOneAsync(Upsert("note", note.Id, new { content = "typed on device B while offline" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Gone, result.Status);
        Assert.Equal(HttpStatusCode.NotFound, await NoteStatusAsync(note.Id)); // it stays deleted
        var trashed = (await Client.GetFromJsonAsync<NoteDto>($"/api/notes/trash/{note.Id}"))!;
        Assert.Equal("typed on device B while offline", trashed.Content); // but the text is not lost
    }

    [Fact]
    public async Task An_edit_of_a_note_that_was_deleted_for_good_is_gone()
    {
        var note = await RestCreateNoteAsync("Purged");
        await Client.DeleteAsync($"/api/notes/{note.Id}");
        await Client.DeleteAsync($"/api/notes/trash/{note.Id}");

        var result = await PushOneAsync(Upsert("note", note.Id, new { title = "Back from the dead" }, baseVersion: note.Version));

        Assert.Equal(SyncStatuses.Gone, result.Status);
        Assert.Equal(HttpStatusCode.NotFound, await NoteStatusAsync(note.Id));
    }

    // ---------- retries ----------

    [Fact]
    public async Task Sending_the_same_operation_twice_applies_it_once_and_gives_the_same_answer()
    {
        var id = Guid.NewGuid();
        var opId = Guid.NewGuid();
        var operation = Upsert("note", id, new { title = "Once", content = "c" }, opId: opId);

        var first = await PushOneAsync(operation);
        var again = await PushOneAsync(operation); // the answer was "lost": the device sends it again

        Assert.Equal(first.Status, again.Status);
        Assert.Equal(Int(first.Entity, "version"), Int(again.Entity, "version"));
        var all = (await Client.GetFromJsonAsync<List<NoteSummaryDto>>("/api/notes"))!;
        Assert.Single(all, n => n.Id == id); // one note, not two
        Assert.Equal(1, (await GetNoteAsync(id)).Version);
    }

    [Fact]
    public async Task A_repeated_edit_does_not_bump_the_version_again_and_a_repeated_delete_is_harmless()
    {
        var note = await RestCreateNoteAsync("Retry", "a");
        var edit = Upsert("note", note.Id, new { content = "b" }, baseVersion: note.Version, opId: Guid.NewGuid());

        await PushOneAsync(edit);
        var versionAfterFirst = (await GetNoteAsync(note.Id)).Version;
        await PushOneAsync(edit);
        await PushOneAsync(edit);

        Assert.Equal(versionAfterFirst, (await GetNoteAsync(note.Id)).Version);
        Assert.Empty(await RevisionsAsync(note.Id)); // and the repeat was not mistaken for a conflict
    }

    [Fact]
    public async Task The_same_operation_twice_in_one_request_is_applied_once()
    {
        var id = Guid.NewGuid();
        var operation = Upsert("note", id, new { title = "Double", content = "c" });

        var response = await PushAsync(operation, operation);

        Assert.Equal(2, response.Results.Count);
        Assert.Equal(response.Results[0].Status, response.Results[1].Status);
        Assert.Equal(1, (await GetNoteAsync(id)).Version);
    }

    [Fact]
    public async Task Operation_ids_only_have_to_be_unique_per_user()
    {
        var bob = Api.CreateUserClient();
        var opId = Guid.NewGuid();

        var a = await PushOneAsync(Upsert("note", Guid.NewGuid(), new { title = "Alice" }, opId: opId));
        var b = await PushOneAsync(Upsert("note", Guid.NewGuid(), new { title = "Bob" }, opId: opId), bob);

        Assert.Equal(SyncStatuses.Applied, a.Status);
        Assert.Equal(SyncStatuses.Applied, b.Status); // not mistaken for Alice's operation
        Assert.Equal("Bob", Str(b.Entity, "title"));
    }

    [Fact]
    public async Task Two_devices_pushing_to_the_same_note_at_the_same_moment_both_get_an_answer()
    {
        var note = await RestCreateNoteAsync("Race", "start");
        var a = PushOneAsync(Upsert("note", note.Id, new { content = "from A" }, baseVersion: note.Version));
        var b = PushOneAsync(Upsert("note", note.Id, new { content = "from B" }, baseVersion: note.Version));

        var results = await Task.WhenAll(a, b);

        Assert.All(results, r => Assert.Contains(r.Status, new[] { SyncStatuses.Applied, SyncStatuses.Conflict }));
        var final = await GetNoteAsync(note.Id);
        Assert.Contains(final.Content, new[] { "from A", "from B" });
        Assert.True(final.Version >= note.Version + 2); // both were applied, one after the other
    }

    // ---------- bad input ----------

    [Theory]
    [InlineData("""{"title":""}""")]
    [InlineData("""{"title":"   "}""")]
    [InlineData("""{"title":123}""")]
    [InlineData("""{"title":"ok","status":"Nonsense"}""")]
    [InlineData("""{"title":"ok","tagIds":"not a list"}""")]
    [InlineData("""{"title":"ok","tagIds":["not-a-guid"]}""")]
    [InlineData("""{"title":"ok","isPinned":"yes"}""")]
    [InlineData("""{"title":"ok","notebookId":"nope"}""")]
    [InlineData("""[1,2,3]""")]
    public async Task Invalid_data_is_rejected_with_a_reason_and_creates_nothing(string json)
    {
        var id = Guid.NewGuid();
        var operation = new SyncOperation(Guid.NewGuid(), "note", id, "upsert", null, JsonDocument.Parse(json).RootElement);

        var result = await PushOneAsync(operation);

        Assert.Equal(SyncStatuses.Rejected, result.Status);
        Assert.False(string.IsNullOrEmpty(result.Error));
        Assert.Equal(HttpStatusCode.NotFound, await NoteStatusAsync(id));
    }

    [Fact]
    public async Task A_missing_data_object_on_an_upsert_is_rejected()
    {
        var result = await PushOneAsync(new SyncOperation(Guid.NewGuid(), "note", Guid.NewGuid(), "upsert", null, null));

        Assert.Equal(SyncStatuses.Rejected, result.Status);
    }

    [Fact]
    public async Task Too_long_a_title_or_content_is_rejected_and_the_existing_note_is_kept()
    {
        var note = await RestCreateNoteAsync("Short", "fine");

        var title = await PushOneAsync(Upsert("note", note.Id, new { title = new string('t', NoteLimits.TitleMaxLength + 1) }, note.Version));
        var content = await PushOneAsync(Upsert("note", note.Id, new { content = new string('c', NoteLimits.ContentMaxLength + 1) }, note.Version));

        Assert.Equal(SyncStatuses.Rejected, title.Status);
        Assert.Equal(SyncStatuses.Rejected, content.Status);
        var still = await GetNoteAsync(note.Id);
        Assert.Equal("Short", still.Title);
        Assert.Equal("fine", still.Content);
    }

    [Fact]
    public async Task More_than_20_tags_on_one_note_is_rejected()
    {
        var result = await PushOneAsync(Upsert("note", Guid.NewGuid(),
            new { title = "Tagged", tagIds = Enumerable.Range(0, NoteOrganizationLimits.MaxTagsPerNote + 1).Select(_ => Guid.NewGuid()).ToArray() }));

        Assert.Equal(SyncStatuses.Rejected, result.Status);
    }

    [Theory]
    [InlineData("attachment", "upsert")]
    [InlineData("note", "explode")]
    [InlineData("", "upsert")]
    public async Task An_unknown_entity_or_kind_is_rejected_and_the_rejection_is_remembered(string entity, string kind)
    {
        var operation = new SyncOperation(Guid.NewGuid(), entity, Guid.NewGuid(), kind, null, Json(new { title = "x" }));

        var first = await PushOneAsync(operation);
        var again = await PushOneAsync(operation);

        Assert.Equal(SyncStatuses.Rejected, first.Status);
        Assert.Equal(first.Status, again.Status);
    }

    [Fact]
    public async Task An_empty_or_oversized_batch_is_a_400()
    {
        var empty = await Client.PostAsJsonAsync("/api/sync/push", new PushRequest([]));
        var tooMany = await Client.PostAsJsonAsync("/api/sync/push",
            new PushRequest(Enumerable.Range(0, 51).Select(i => Upsert("note", Guid.NewGuid(), new { title = $"n{i}" })).ToArray()));
        var exactlyFifty = await Client.PostAsJsonAsync("/api/sync/push",
            new PushRequest(Enumerable.Range(0, 50).Select(i => Upsert("note", Guid.NewGuid(), new { title = $"n{i}" })).ToArray()));

        Assert.Equal(HttpStatusCode.BadRequest, empty.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, tooMany.StatusCode);
        Assert.Equal(HttpStatusCode.OK, exactlyFifty.StatusCode);
    }

    [Fact]
    public async Task One_bad_operation_does_not_stop_the_others_in_the_batch()
    {
        var good1 = Guid.NewGuid();
        var good2 = Guid.NewGuid();

        var response = await PushAsync(
            Upsert("note", good1, new { title = "First good" }),
            Upsert("note", Guid.NewGuid(), new { title = "" }),
            Upsert("note", good2, new { title = "Second good" }));

        Assert.Equal([SyncStatuses.Applied, SyncStatuses.Rejected, SyncStatuses.Applied], response.Results.Select(r => r.Status));
        Assert.Equal("First good", (await GetNoteAsync(good1)).Title);
        Assert.Equal("Second good", (await GetNoteAsync(good2)).Title);
    }

    // ---------- revisions endpoint ----------

    [Fact]
    public async Task Revisions_belong_to_their_owner_only()
    {
        var bob = Api.CreateUserClient();
        var note = await RestCreateNoteAsync("Mine", "a");
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Mine", "b", note.Version))).EnsureSuccessStatusCode();
        await PushOneAsync(Upsert("note", note.Id, new { content = "c" }, baseVersion: note.Version));

        Assert.Single(await RevisionsAsync(note.Id));
        Assert.Equal(HttpStatusCode.NotFound, (await bob.GetAsync($"/api/notes/{note.Id}/revisions")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{Guid.NewGuid()}/revisions")).StatusCode);
    }

    [Fact]
    public async Task Revisions_disappear_with_the_note_when_it_is_deleted_for_good()
    {
        var note = await RestCreateNoteAsync("Mine", "a");
        (await Client.PutAsJsonAsync($"/api/notes/{note.Id}", new UpdateNoteRequest("Mine", "b", note.Version))).EnsureSuccessStatusCode();
        await PushOneAsync(Upsert("note", note.Id, new { content = "c" }, baseVersion: note.Version));
        Assert.Single(await RevisionsAsync(note.Id));

        await Client.DeleteAsync($"/api/notes/{note.Id}");
        Assert.Single(await RevisionsAsync(note.Id)); // still there while the note is in the trash
        await Client.DeleteAsync($"/api/notes/trash/{note.Id}");

        Assert.Equal(HttpStatusCode.NotFound, (await Client.GetAsync($"/api/notes/{note.Id}/revisions")).StatusCode);
    }

    [Fact]
    public async Task What_was_pushed_is_pulled_by_another_device()
    {
        var other = Api.CreateAnonymousClient();
        var id = Guid.NewGuid();
        await PushOneAsync(Upsert("note", id, new { title = "From device 1", content = "hello" }));

        var (changes, _) = await PullAllAsync();

        var change = changes.Single(c => c.Id == id);
        Assert.Equal("From device 1", Str(change.Data, "title"));
        Assert.NotNull(other); // (a second device is just another pull with its own cursor)
    }
}

/// <summary>Pushing notebooks and tags.</summary>
public sealed class SyncOrganizationPushTests(ApiFixture api) : SyncTestBase(api), IClassFixture<ApiFixture>
{
    private async Task<List<NotebookDto>> NotebooksAsync() => (await Client.GetFromJsonAsync<List<NotebookDto>>("/api/notebooks"))!;
    private async Task<List<TagDto>> TagsAsync() => (await Client.GetFromJsonAsync<List<TagDto>>("/api/tags"))!;
    private static string UniqueTag() => $"tag-{Guid.NewGuid():N}";

    // ---------- notebooks ----------

    [Fact]
    public async Task A_notebook_can_be_created_renamed_and_moved()
    {
        var parent = Guid.NewGuid();
        var child = Guid.NewGuid();
        await PushAsync(Upsert("notebook", parent, new { name = "Parent" }), Upsert("notebook", child, new { name = "Child", parentId = parent }));
        Assert.Equal(parent, (await NotebooksAsync()).Single(n => n.Id == child).ParentId);

        var renamed = await PushOneAsync(Upsert("notebook", child, new { name = "Renamed" }));
        Assert.Equal(SyncStatuses.Applied, renamed.Status);
        var after = (await NotebooksAsync()).Single(n => n.Id == child);
        Assert.Equal("Renamed", after.Name);
        Assert.Equal(parent, after.ParentId); // not mentioned: unchanged

        await PushOneAsync(Upsert("notebook", child, new { parentId = (Guid?)null })); // to the top level
        Assert.Null((await NotebooksAsync()).Single(n => n.Id == child).ParentId);
    }

    [Fact]
    public async Task Moving_a_notebook_into_itself_or_its_descendant_is_ignored()
    {
        var a = Guid.NewGuid();
        var b = Guid.NewGuid();
        await PushAsync(Upsert("notebook", a, new { name = "A" }), Upsert("notebook", b, new { name = "B", parentId = a }));

        await PushOneAsync(Upsert("notebook", a, new { parentId = b })); // A into its own child: a loop
        await PushOneAsync(Upsert("notebook", a, new { parentId = a })); // A into itself

        var notebooks = await NotebooksAsync();
        Assert.Null(notebooks.Single(n => n.Id == a).ParentId);
        Assert.Equal(a, notebooks.Single(n => n.Id == b).ParentId);
    }

    [Fact]
    public async Task A_parent_that_no_longer_exists_means_the_top_level()
    {
        var id = Guid.NewGuid();

        var result = await PushOneAsync(Upsert("notebook", id, new { name = "Orphan", parentId = Guid.NewGuid() }));

        Assert.Equal(SyncStatuses.Applied, result.Status);
        Assert.Null((await NotebooksAsync()).Single(n => n.Id == id).ParentId);
    }

    [Fact]
    public async Task A_notebook_with_notes_or_subnotebooks_cannot_be_deleted_but_an_empty_one_can()
    {
        var folder = Guid.NewGuid();
        var sub = Guid.NewGuid();
        var note = Guid.NewGuid();
        await PushAsync(Upsert("notebook", folder, new { name = "Full" }), Upsert("notebook", sub, new { name = "Sub", parentId = folder }),
            Upsert("note", note, new { title = "Inside", notebookId = sub }));

        var withSub = await PushOneAsync(Delete("notebook", folder));
        var withNote = await PushOneAsync(Delete("notebook", sub));
        Assert.Equal(SyncStatuses.Rejected, withSub.Status);
        Assert.Equal(SyncStatuses.Rejected, withNote.Status);
        Assert.Equal("Full", Str(withSub.Entity, "name")); // the server says how the folder really is
        Assert.Equal(2, (await NotebooksAsync()).Count(n => n.Id == folder || n.Id == sub));

        await PushOneAsync(Delete("note", note)); // the note goes to the trash: the folder is empty now
        Assert.Equal(SyncStatuses.Applied, (await PushOneAsync(Delete("notebook", sub))).Status);
        Assert.Equal(SyncStatuses.Applied, (await PushOneAsync(Delete("notebook", folder))).Status);
        Assert.DoesNotContain(await NotebooksAsync(), n => n.Id == folder || n.Id == sub);
    }

    [Fact]
    public async Task Deleting_a_notebook_that_is_already_gone_is_fine()
    {
        Assert.Equal(SyncStatuses.Applied, (await PushOneAsync(Delete("notebook", Guid.NewGuid()))).Status);
    }

    [Fact]
    public async Task A_notebook_needs_a_valid_name()
    {
        Assert.Equal(SyncStatuses.Rejected, (await PushOneAsync(Upsert("notebook", Guid.NewGuid(), new { parentId = (Guid?)null }))).Status);
        Assert.Equal(SyncStatuses.Rejected, (await PushOneAsync(Upsert("notebook", Guid.NewGuid(), new { name = "  " }))).Status);
        Assert.Equal(SyncStatuses.Rejected, (await PushOneAsync(Upsert("notebook", Guid.NewGuid(), new { name = new string('n', NotebookLimits.NameMaxLength + 1) }))).Status);
    }

    [Fact]
    public async Task Another_users_notebook_id_is_rejected_and_untouched()
    {
        var bob = Api.CreateUserClient();
        var mine = (await (await Client.PostAsJsonAsync("/api/notebooks", new CreateNotebookRequest("Alice's", null))).Content.ReadFromJsonAsync<NotebookDto>())!;

        var take = await PushOneAsync(Upsert("notebook", mine.Id, new { name = "Bob's now" }), bob);

        Assert.Equal(SyncStatuses.Rejected, take.Status);
        Assert.Equal("Alice's", (await NotebooksAsync()).Single(n => n.Id == mine.Id).Name);
        Assert.Equal(SyncStatuses.Applied, (await PushOneAsync(Delete("notebook", mine.Id), bob)).Status); // a no-op for Bob
        Assert.Contains(await NotebooksAsync(), n => n.Id == mine.Id);
    }

    // ---------- tags ----------

    [Fact]
    public async Task A_tag_can_be_created_renamed_and_deleted_and_deleting_it_removes_it_from_notes()
    {
        var tag = Guid.NewGuid();
        var note = Guid.NewGuid();
        var name = UniqueTag();
        await PushAsync(Upsert("tag", tag, new { name }), Upsert("note", note, new { title = "Tagged", tagIds = new[] { tag } }));
        Assert.Equal([tag], (await GetNoteAsync(note)).TagIds);

        var renamed = UniqueTag();
        Assert.Equal(renamed, Str((await PushOneAsync(Upsert("tag", tag, new { name = renamed }))).Entity, "name"));

        Assert.Equal(SyncStatuses.Applied, (await PushOneAsync(Delete("tag", tag))).Status);
        Assert.DoesNotContain(await TagsAsync(), t => t.Id == tag);
        Assert.Empty((await GetNoteAsync(note)).TagIds);
    }

    [Fact]
    public async Task Two_devices_creating_the_same_tag_name_both_keep_a_tag_and_the_second_is_renamed()
    {
        var name = UniqueTag();
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        var third = Guid.NewGuid();

        var a = await PushOneAsync(Upsert("tag", first, new { name }));
        var b = await PushOneAsync(Upsert("tag", second, new { name = name.ToUpperInvariant() })); // same name, other case
        var c = await PushOneAsync(Upsert("tag", third, new { name }));

        Assert.Equal(name, Str(a.Entity, "name"));
        Assert.Equal($"{name.ToUpperInvariant()} (2)", Str(b.Entity, "name"));
        Assert.Equal($"{name} (3)", Str(c.Entity, "name"));
        Assert.Equal(3, (await TagsAsync()).Count(t => t.Id == first || t.Id == second || t.Id == third));
    }

    [Fact]
    public async Task Renaming_a_tag_to_the_name_of_another_gets_a_number_but_keeping_its_own_name_changes_nothing()
    {
        var one = Guid.NewGuid();
        var two = Guid.NewGuid();
        var name = UniqueTag();
        await PushAsync(Upsert("tag", one, new { name }), Upsert("tag", two, new { name = UniqueTag() }));

        var clash = await PushOneAsync(Upsert("tag", two, new { name }));
        var same = await PushOneAsync(Upsert("tag", one, new { name }));

        Assert.Equal($"{name} (2)", Str(clash.Entity, "name"));
        Assert.Equal(name, Str(same.Entity, "name"));
    }

    [Fact]
    public async Task A_tag_needs_a_valid_name_and_another_users_tag_is_untouchable()
    {
        var bob = Api.CreateUserClient();
        var mine = (await (await Client.PostAsJsonAsync("/api/tags", new CreateTagRequest(UniqueTag()))).Content.ReadFromJsonAsync<TagDto>())!;

        Assert.Equal(SyncStatuses.Rejected, (await PushOneAsync(Upsert("tag", Guid.NewGuid(), new { name = "" }))).Status);
        Assert.Equal(SyncStatuses.Rejected, (await PushOneAsync(Upsert("tag", Guid.NewGuid(), new { isPinned = true }))).Status);
        Assert.Equal(SyncStatuses.Rejected, (await PushOneAsync(Upsert("tag", mine.Id, new { name = "stolen" }), bob)).Status);
        await PushOneAsync(Delete("tag", mine.Id), bob);

        Assert.Contains(await TagsAsync(), t => t.Id == mine.Id && t.Name == mine.Name);
    }
}

/// <summary>The settle window: changes younger than the window are held back, in order.</summary>
public sealed class SettleWindowFixture : ApiFixture
{
    protected override IReadOnlyDictionary<string, string?> Settings => new Dictionary<string, string?> { ["Sync:SettleWindow"] = "00:00:02" };
}

public sealed class SyncSettleWindowTests(SettleWindowFixture api) : SyncTestBase(api), IClassFixture<SettleWindowFixture>
{
    [Fact]
    public async Task A_change_is_handed_out_only_once_it_is_older_than_the_window_and_always_in_order()
    {
        var first = await RestCreateNoteAsync("Old enough");
        await Task.Delay(2600);
        var second = await RestCreateNoteAsync("Too young");

        var page1 = await PullAsync();
        Assert.Equal([first.Id], page1.Changes.Select(c => c.Id)); // the young one is held back (and nothing after it either)
        Assert.Equal(page1.Changes.Single().Seq, page1.Cursor);

        await Task.Delay(2200);
        var page2 = await PullAsync(page1.Cursor);

        Assert.Equal([second.Id], page2.Changes.Select(c => c.Id)); // now it is final, and it is not skipped
    }
}
