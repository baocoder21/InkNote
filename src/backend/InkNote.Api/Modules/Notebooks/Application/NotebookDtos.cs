using InkNote.Api.Modules.Notebooks.Domain;

namespace InkNote.Api.Modules.Notebooks.Application;

// The API returns a flat list; each item says who its parent is. Building the tree is the
// client's job (cheap, and the same list also serves a "move to..." picker).
public sealed record NotebookDto(Guid Id, string Name, Guid? ParentId)
{
    public static NotebookDto From(Notebook notebook) => new(notebook.Id, notebook.Name, notebook.ParentId);
}

public sealed record CreateNotebookRequest(string Name, Guid? ParentId);

// Used both to rename and to move (change ParentId) a notebook.
public sealed record UpdateNotebookRequest(string Name, Guid? ParentId);
