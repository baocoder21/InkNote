using InkNote.Api.Modules.Tags.Contracts;
using InkNote.Api.Modules.Tags.Domain;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace InkNote.Api.Modules.Tags.Application;

public enum TagStatus { Ok, NotFound, Duplicate }

public sealed record TagResult(TagStatus Status, TagDto? Tag = null);

/// <summary>Use cases for tags.</summary>
public sealed class TagService(AppDbContext db, TimeProvider clock)
{
    public async Task<IReadOnlyList<TagDto>> ListAsync(CancellationToken ct) =>
        await db.Tags
            .AsNoTracking()
            .OrderBy(t => t.NormalizedName)
            .Select(t => new TagDto(t.Id, t.Name))
            .ToListAsync(ct);

    public async Task<TagResult> CreateAsync(CreateTagRequest request, CancellationToken ct)
    {
        var tag = Tag.Create(request.Name, clock.GetUtcNow());

        // Friendly pre-check; the unique index below is the real guarantee.
        if (await db.Tags.AnyAsync(t => t.NormalizedName == tag.NormalizedName, ct))
        {
            return new TagResult(TagStatus.Duplicate);
        }

        db.Tags.Add(tag);
        return await SaveAsync(tag, ct);
    }

    public async Task<TagResult> RenameAsync(Guid id, UpdateTagRequest request, CancellationToken ct)
    {
        var tag = await db.Tags.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tag is null)
        {
            return new TagResult(TagStatus.NotFound);
        }

        var normalized = Tag.Normalize(request.Name);
        if (await db.Tags.AnyAsync(t => t.NormalizedName == normalized && t.Id != id, ct))
        {
            return new TagResult(TagStatus.Duplicate);
        }

        tag.Rename(request.Name);
        return await SaveAsync(tag, ct);
    }

    /// <returns>false when the tag does not exist.</returns>
    public async Task<bool> DeleteAsync(Guid id, CancellationToken ct)
    {
        var tag = await db.Tags.FirstOrDefaultAsync(t => t.Id == id, ct);
        if (tag is null)
        {
            return false;
        }

        db.Tags.Remove(tag); // the database cascades to note_tags (the tag leaves every note)
        await db.SaveChangesAsync(ct);
        return true;
    }

    private async Task<TagResult> SaveAsync(Tag tag, CancellationToken ct)
    {
        try
        {
            await db.SaveChangesAsync(ct);
        }
        catch (DbUpdateException ex) when (ex.InnerException is PostgresException { SqlState: PostgresErrorCodes.UniqueViolation })
        {
            // Two requests created the same name at the same moment: the unique index caught it.
            return new TagResult(TagStatus.Duplicate);
        }

        return new TagResult(TagStatus.Ok, TagDto.From(tag));
    }
}

/// <summary>What the Notes module may ask: are these ids real tags?</summary>
internal sealed class TagLookup(AppDbContext db) : ITagLookup
{
    public Task<int> CountExistingAsync(IReadOnlyCollection<Guid> tagIds, CancellationToken ct) =>
        db.Tags.CountAsync(t => tagIds.Contains(t.Id), ct);
}
