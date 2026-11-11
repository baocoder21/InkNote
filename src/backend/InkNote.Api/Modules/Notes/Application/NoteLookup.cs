using InkNote.Api.Modules.Notes.Contracts;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Modules.Notes.Application;

/// <summary>Implements the contract other modules use to ask about a note; the owner check is in <c>NotesIncludingDeleted</c>.</summary>
public sealed class NoteLookup(AppDbContext db) : INoteLookup
{
    public Task<bool> ExistsAsync(Guid noteId, CancellationToken ct) =>
        db.NotesIncludingDeleted.AnyAsync(n => n.Id == noteId, ct);
}
