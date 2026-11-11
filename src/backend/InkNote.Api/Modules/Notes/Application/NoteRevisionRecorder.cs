using InkNote.Api.Common;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Notes.Application;

/// <summary>Settings under "Notes:Revisions".</summary>
public sealed class NoteRevisionOptions
{
    public const string SectionName = "Notes:Revisions";

    /// <summary>
    /// At most one automatic snapshot per note in this time. A note is saved every few seconds while the user types:
    /// a snapshot for each save would bury the history. One per editing session is what a person can use.
    /// </summary>
    public TimeSpan Interval { get; set; } = TimeSpan.FromMinutes(10);

    /// <summary>The most snapshots kept for one note; the oldest go first.</summary>
    public int MaxPerNote { get; set; } = 50;
}

/// <summary>
/// Keeps the history of a note's text. A snapshot is the text as it WAS, saved just before something replaces it, so
/// "go back" always has somewhere to go back to.
/// </summary>
public sealed class NoteRevisionRecorder(AppDbContext db, ICurrentUser user, IOptions<NoteRevisionOptions> options)
{
    /// <summary>
    /// Call BEFORE the note's text is changed. Adds a snapshot of the current text (to be saved with the change) when
    /// the change really alters the text, the text is worth keeping, and the last snapshot is old enough.
    /// </summary>
    public async Task RecordBeforeEditAsync(Note note, string? newTitle, string? newContent, DateTimeOffset now, CancellationToken ct)
    {
        var changesText = (newTitle is not null && newTitle != note.Title) || (newContent is not null && newContent != note.Content);
        if (!changesText || string.IsNullOrWhiteSpace(note.Content))
        {
            return; // a note nobody has written in yet has nothing to go back to
        }

        // A snapshot of this very note is already waiting to be saved (the sync made one for a conflict): that one will do.
        if (db.ChangeTracker.Entries<NoteRevision>().Any(e => e.State == EntityState.Added && e.Entity.NoteId == note.Id))
        {
            return;
        }

        var last = await db.NoteRevisions.AsNoTracking()
            .Where(r => r.NoteId == note.Id)
            .OrderByDescending(r => r.CreatedAt)
            .Select(r => new { r.Id, r.CreatedAt })
            .FirstOrDefaultAsync(ct);

        // The age is counted from the last snapshot, or from the note's creation when it has none yet: the first
        // minutes of a NEW note (a few words typed, saved every few seconds) are not worth a snapshot each.
        if (now - (last?.CreatedAt ?? note.CreatedAt) < options.Value.Interval)
        {
            return;
        }

        // The text is exactly what the last snapshot holds (nothing was edited since): another copy adds nothing.
        // (Asked of the database, so the whole text is not read into memory just to compare.)
        if (last is not null && await db.NoteRevisions.AnyAsync(r => r.Id == last.Id && r.Title == note.Title && r.Content == note.Content, ct))
        {
            return;
        }

        await AddAsync(note, NoteRevision.EditReason, now, ct);
    }

    /// <summary>A snapshot that is always made (before a restore): whatever its age, the text must not be lost.</summary>
    public async Task AddAsync(Note note, string reason, DateTimeOffset now, CancellationToken ct)
    {
        // Keep room for the new one: delete the oldest until there are at most MaxPerNote - 1.
        var count = await db.NoteRevisions.CountAsync(r => r.NoteId == note.Id, ct);
        var excess = count - (options.Value.MaxPerNote - 1);
        if (excess > 0)
        {
            var oldest = await db.NoteRevisions
                .Where(r => r.NoteId == note.Id)
                .OrderBy(r => r.CreatedAt)
                .Take(excess)
                .Select(r => r.Id)
                .ToListAsync(ct);
            await db.NoteRevisions.Where(r => oldest.Contains(r.Id)).ExecuteDeleteAsync(ct);
        }

        db.NoteRevisions.Add(NoteRevision.Create(user.RequiredUserId, note, reason, now));
    }
}
