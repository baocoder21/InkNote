using System.Text.Json;

namespace InkNote.Api.Modules.Sync.Contracts;

/// <summary>The kinds of things that are synchronized. These strings are part of the API.</summary>
public static class SyncEntities
{
    public const string Note = "note";
    public const string Notebook = "notebook";
    public const string Tag = "tag";
}

public static class SyncKinds
{
    /// <summary>Create the thing if it does not exist, otherwise change the fields that are in the data.</summary>
    public const string Upsert = "upsert";
    public const string Delete = "delete";
}

/// <summary>What happened to one operation. These strings are part of the API.</summary>
public static class SyncStatuses
{
    /// <summary>Done as asked.</summary>
    public const string Applied = "applied";

    /// <summary>
    /// Done, but the server had moved on since the version the client saw: the client's fields won and the text it
    /// replaced was saved as a NoteRevision. The client tells the user.
    /// </summary>
    public const string Conflict = "conflict";

    /// <summary>Not done, and it will never work as it is (invalid data, id taken, folder not empty...).</summary>
    public const string Rejected = "rejected";

    /// <summary>The thing was deleted on the server; the client must drop its copy.</summary>
    public const string Gone = "gone";
}

/// <summary>
/// One change made on a device. OpId identifies THIS change: sending it twice (a retry after a lost answer)
/// must not apply it twice. BaseVersion is the version of the thing the device had when it made the change
/// (null = the device created it). Data holds the fields that changed (an upsert) and is absent for a delete.
/// </summary>
public sealed record SyncOperation(Guid OpId, string Entity, Guid Id, string Kind, int? BaseVersion, JsonElement? Data);

/// <param name="Entity">The server's current version of the thing (a NoteDto, NotebookDto or TagDto), when there is one.</param>
public sealed record SyncOpResult(string Status, object? Entity = null, string? Error = null);

/// <summary>One thing that changed on the server. Seq is its position in the global order of changes.</summary>
public sealed record SyncChange(long Seq, string Entity, Guid Id, bool Deleted, object? Data);

/// <summary>
/// What every module with synchronized data implements, so the Sync module can serve and accept changes without
/// ever touching another module's tables.
/// </summary>
public interface ISyncHandler
{
    string Entity { get; }

    /// <summary>The current user's changes with after &lt; Seq &lt; before, oldest first, at most `limit`.</summary>
    Task<IReadOnlyList<SyncChange>> PullAsync(long after, long before, int limit, CancellationToken ct);

    /// <summary>
    /// The smallest Seq among changes made after `since` (null if none): the Sync module only hands out changes
    /// that are older than the settle window (see SyncService), so it needs to know where the "recent" ones begin.
    /// </summary>
    Task<long?> OldestSeqSinceAsync(DateTimeOffset since, CancellationToken ct);

    /// <summary>Applies one operation of this handler's entity for the current user.</summary>
    Task<SyncOpResult> ApplyAsync(SyncOperation operation, DateTimeOffset now, CancellationToken ct);
}
