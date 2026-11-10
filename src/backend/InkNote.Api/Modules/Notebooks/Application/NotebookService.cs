using InkNote.Api.Common;
using InkNote.Api.Modules.Notebooks.Contracts;
using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Contracts;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Modules.Notebooks.Application;

public enum NotebookStatus { Ok, NotFound, InvalidParent, NotEmpty }

public sealed record NotebookResult(NotebookStatus Status, NotebookDto? Notebook = null, string? Message = null);

/// <summary>Use cases for notebooks.</summary>
public sealed class NotebookService(AppDbContext db, ICurrentUser user, INotebookUsage usage, TimeProvider clock)
{
    public async Task<IReadOnlyList<NotebookDto>> ListAsync(CancellationToken ct) =>
        await db.Notebooks
            .AsNoTracking()
            .OrderBy(n => n.Name)
            .Select(n => new NotebookDto(n.Id, n.Name, n.ParentId))
            .ToListAsync(ct);

    public async Task<NotebookResult> CreateAsync(CreateNotebookRequest request, CancellationToken ct)
    {
        if (request.ParentId is { } parentId && !await db.Notebooks.AnyAsync(n => n.Id == parentId, ct))
        {
            return new NotebookResult(NotebookStatus.InvalidParent, Message: "The parent notebook does not exist.");
        }

        var notebook = Notebook.Create(user.RequiredUserId, request.Name.Trim(), request.ParentId, clock.GetUtcNow());
        db.Notebooks.Add(notebook);
        await db.SaveChangesAsync(ct);
        return new NotebookResult(NotebookStatus.Ok, NotebookDto.From(notebook));
    }

    public async Task<NotebookResult> UpdateAsync(Guid id, UpdateNotebookRequest request, CancellationToken ct)
    {
        var notebook = await db.Notebooks.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (notebook is null)
        {
            return new NotebookResult(NotebookStatus.NotFound);
        }

        if (request.ParentId is { } newParentId)
        {
            // Load only (id, parent) pairs: the whole tree is small and this is enough to walk it.
            var parents = await db.Notebooks
                .AsNoTracking()
                .ToDictionaryAsync(n => n.Id, n => n.ParentId, ct);

            if (!parents.ContainsKey(newParentId))
            {
                return new NotebookResult(NotebookStatus.InvalidParent, Message: "The parent notebook does not exist.");
            }

            // Cycle check: walk from the new parent up to the root. If we meet the notebook
            // being edited, the new parent is the notebook itself or one of its descendants.
            for (Guid? current = newParentId; current is { } step; parents.TryGetValue(step, out current))
            {
                if (step == id)
                {
                    return new NotebookResult(
                        NotebookStatus.InvalidParent,
                        Message: "A notebook cannot be moved into itself or into one of its sub-notebooks.");
                }
            }
        }

        notebook.Update(request.Name.Trim(), request.ParentId, clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return new NotebookResult(NotebookStatus.Ok, NotebookDto.From(notebook));
    }

    public async Task<NotebookResult> DeleteAsync(Guid id, CancellationToken ct)
    {
        var notebook = await db.Notebooks.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (notebook is null)
        {
            return new NotebookResult(NotebookStatus.NotFound);
        }

        // Refuse to delete a notebook that still has content: no surprise data loss.
        var hasChildren = await db.Notebooks.AnyAsync(n => n.ParentId == id, ct);
        if (hasChildren || await usage.HasNotesAsync(id, ct))
        {
            return new NotebookResult(
                NotebookStatus.NotEmpty,
                Message: "The notebook still contains notes or sub-notebooks. Move or delete them first.");
        }

        db.Notebooks.Remove(notebook); // hard delete (see docs/DECISIONS.md)
        await db.SaveChangesAsync(ct);
        return new NotebookResult(NotebookStatus.Ok);
    }
}

/// <summary>What the Notes module may ask: does this notebook exist?</summary>
internal sealed class NotebookLookup(AppDbContext db) : INotebookLookup
{
    public Task<bool> ExistsAsync(Guid notebookId, CancellationToken ct) =>
        db.Notebooks.AnyAsync(n => n.Id == notebookId, ct);
}
