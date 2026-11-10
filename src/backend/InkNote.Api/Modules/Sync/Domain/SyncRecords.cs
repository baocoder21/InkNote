namespace InkNote.Api.Modules.Sync.Domain;

/// <summary>
/// "This thing was deleted". Written by a DATABASE trigger whenever a row of notes, notebooks or tags is
/// deleted (so it does not matter which code path deleted it, a foreign-key cascade included): without it a
/// device that asks "what changed?" could not learn about something whose row no longer exists.
/// The Seq comes from the same sequence as the changes of the other tables.
/// </summary>
public sealed class SyncTombstone
{
    private SyncTombstone() { }

    public Guid Id { get; private set; }
    public Guid UserId { get; private set; }
    public string Entity { get; private set; } = string.Empty;
    public Guid EntityId { get; private set; }
    public long SyncSeq { get; private set; }
    public DateTimeOffset SyncAt { get; private set; }
}

/// <summary>
/// The answer given to an operation, kept by OpId. A device that never received the answer (the connection
/// dropped) sends the same operation again; finding it here, the server returns the same answer instead of
/// applying the change a second time. That property is called idempotency.
/// </summary>
public sealed class SyncOperationRecord
{
    private SyncOperationRecord() { }

    public SyncOperationRecord(Guid userId, Guid opId, string result, DateTimeOffset now)
    {
        UserId = userId;
        OpId = opId;
        Result = result;
        CreatedAt = now;
    }

    public Guid UserId { get; private set; }
    public Guid OpId { get; private set; }

    /// <summary>The SyncOpResult as JSON.</summary>
    public string Result { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }
}
