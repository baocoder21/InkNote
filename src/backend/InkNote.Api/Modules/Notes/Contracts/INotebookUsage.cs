namespace InkNote.Api.Modules.Notes.Contracts;

/// <summary>The only thing other modules may ask the Notes module about notebooks.</summary>
public interface INotebookUsage
{
    /// <summary>True when at least one (non-deleted) note lives in the notebook.</summary>
    Task<bool> HasNotesAsync(Guid notebookId, CancellationToken ct);
}
