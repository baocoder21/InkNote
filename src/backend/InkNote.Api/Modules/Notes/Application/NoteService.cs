using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;

namespace InkNote.Api.Modules.Notes.Application;

public enum UpdateNoteStatus { Updated, NotFound, Conflict }

public sealed record UpdateNoteResult(UpdateNoteStatus Status, NoteDto? Note = null);

/// <summary>Use cases for notes. Endpoints stay thin and delegate here.</summary>
public sealed class NoteService(AppDbContext db, TimeProvider clock)
{
    public async Task<IReadOnlyList<NoteSummaryDto>> ListAsync(CancellationToken ct) =>
        await db.Notes
            .AsNoTracking() // read-only query: EF does not need to track changes
            .OrderByDescending(n => n.UpdatedAt)
            .Select(n => new NoteSummaryDto(n.Id, n.Title, n.UpdatedAt, n.Version))
            .ToListAsync(ct);

    public async Task<NoteDto?> GetAsync(Guid id, CancellationToken ct)
    {
        var note = await db.Notes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id, ct);
        return note is null ? null : NoteDto.From(note);
    }

    public async Task<NoteDto> CreateAsync(CreateNoteRequest request, CancellationToken ct)
    {
        var note = Note.Create(request.Title, request.Content, clock.GetUtcNow());
        db.Notes.Add(note);
        await db.SaveChangesAsync(ct);
        return NoteDto.From(note);
    }

    public async Task<UpdateNoteResult> UpdateAsync(Guid id, UpdateNoteRequest request, CancellationToken ct)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return new UpdateNoteResult(UpdateNoteStatus.NotFound);
        }

        // Cheap early check: the client edited an outdated copy.
        if (note.Version != request.Version)
        {
            return new UpdateNoteResult(UpdateNoteStatus.Conflict);
        }

        note.Update(request.Title, request.Content, clock.GetUtcNow());

        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Safety net: someone saved between our read and our write. Version is a
            // concurrency token, so the UPDATE matched 0 rows and EF threw.
            return new UpdateNoteResult(UpdateNoteStatus.Conflict);
        }

        return new UpdateNoteResult(UpdateNoteStatus.Updated, NoteDto.From(note));
    }

    /// <returns>false when the note does not exist.</returns>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        var note = await db.Notes.FirstOrDefaultAsync(n => n.Id == id, ct);
        if (note is null)
        {
            return false;
        }

        note.MarkDeleted(clock.GetUtcNow());
        await db.SaveChangesAsync(ct);
        return true;
    }
}
