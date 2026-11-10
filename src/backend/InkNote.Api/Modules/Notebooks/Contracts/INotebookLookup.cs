namespace InkNote.Api.Modules.Notebooks.Contracts;

/// <summary>
/// The only thing other modules may ask the Notebooks module. Keeping this surface tiny means
/// Notes never touches the Notebook entity or its DbSet.
/// </summary>
public interface INotebookLookup
{
    Task<bool> ExistsAsync(Guid notebookId, CancellationToken ct);
}
