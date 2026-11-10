namespace InkNote.Api.Modules.Tags.Contracts;

/// <summary>The only thing other modules may ask the Tags module.</summary>
public interface ITagLookup
{
    /// <summary>How many of the given ids are real tags (used to reject unknown ids).</summary>
    Task<int> CountExistingAsync(IReadOnlyCollection<Guid> tagIds, CancellationToken ct);

    /// <summary>Only those of the given ids that are real tags (a synchronizing device may mention a tag another device deleted).</summary>
    Task<IReadOnlyList<Guid>> FilterExistingAsync(IReadOnlyCollection<Guid> tagIds, CancellationToken ct);
}
