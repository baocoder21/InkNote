namespace InkNote.Api.Modules.Notebooks.Application;

/// <summary>Rules about the notebook tree that both the REST API and synchronization need.</summary>
public static class NotebookTree
{
    /// <summary>
    /// Would making `newParent` the parent of `notebookId` create a loop? True when newParent is the notebook
    /// itself or one of its descendants: walking from newParent up to the root meets the notebook.
    /// </summary>
    /// <param name="parents">Every notebook of the user: id -> parent id (null = top level).</param>
    public static bool CreatesCycle(IReadOnlyDictionary<Guid, Guid?> parents, Guid notebookId, Guid newParent)
    {
        for (Guid? current = newParent; current is { } step; parents.TryGetValue(step, out current))
        {
            if (step == notebookId)
            {
                return true;
            }
        }

        return false;
    }
}
