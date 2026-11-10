using FluentValidation;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Notes.Infrastructure;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;
using NpgsqlTypes;

namespace InkNote.Api.Modules.Notes.Application;

public static class SearchLimits
{
    public const int QueryMaxLength = 100;
    public const int DefaultPageSize = 20;
    public const int MaxPageSize = 50;

    // Only this much of a note's content is loaded to cut the excerpt from (a note may be 500,000 characters).
    public const int SnippetSourceLength = 100_000;

    // Words shorter than this are only matched by their beginning: a one-letter typo in a 3-letter word is a
    // different word, and trigram similarity on such short words would match far too much.
    public const int MinTypoTermLength = 4;
}

/// <summary>The query string of GET /api/notes/search.</summary>
public sealed record SearchQuery(
    string? Q,
    Guid? NotebookId,
    Guid? TagId,
    int Page = 1,
    int PageSize = SearchLimits.DefaultPageSize);

public sealed class SearchQueryValidator : AbstractValidator<SearchQuery>
{
    public SearchQueryValidator()
    {
        RuleFor(x => x.Q).NotEmpty().MaximumLength(SearchLimits.QueryMaxLength);
        RuleFor(x => x.Page).GreaterThanOrEqualTo(1);
        RuleFor(x => x.PageSize).InclusiveBetween(1, SearchLimits.MaxPageSize);
    }
}

public sealed record SearchResultDto(
    Guid Id,
    IReadOnlyList<TextPart> Title,   // the title, with the matching words marked
    IReadOnlyList<TextPart> Snippet, // a short excerpt of the content around the first match
    DateTimeOffset UpdatedAt,
    Guid? NotebookId,
    bool IsPinned,
    NoteStatus Status,
    IReadOnlyList<Guid> TagIds);

public sealed record SearchResponse(IReadOnlyList<SearchResultDto> Items, int Total, int Page, int PageSize);

/// <summary>
/// Full-text search over the current user's notes (live ones: the usual query filter applies, so other users'
/// notes and the trash can never show up).
///
/// A note matches when EVERY word of the query is satisfied, and a word is satisfied when
///   1. some word of the note STARTS WITH it (the generated tsvector column and its GIN index; "prog" finds
///      "programming"; accents and case are ignored), OR
///   2. (words of 4+ letters) a word in the title or the content is SIMILAR to it (pg_trgm trigrams): a typo such
///      as "meting" still finds "meeting".
/// Results are ordered by relevance: a hit in the title counts more than one in the content, an exact word
/// more than a similar one; ties go to the most recently edited note.
/// </summary>
public sealed class NoteSearchService(AppDbContext db)
{
    public async Task<SearchResponse> SearchAsync(SearchQuery request, CancellationToken ct)
    {
        var terms = SearchText.Terms(request.Q);
        if (terms.Count == 0)
        {
            // Only punctuation, for example "!!!": nothing to search for (and "to_tsquery('')" would be an error).
            return new SearchResponse([], 0, request.Page, request.PageSize);
        }

        // The words are letters and digits only (see SearchText.Terms), so this string cannot contain tsquery
        // syntax: "a:* & b:*" = a word starting with a AND a word starting with b. It is also a PARAMETER of
        // the SQL, never pasted into it.
        var tsQueryText = string.Join(" & ", terms.Select(t => t + ":*"));
        var phrase = string.Join(' ', terms); // for the typo-tolerant comparison

        var notes = db.Notes.AsNoTracking();
        if (request.NotebookId is { } notebookId)
        {
            notes = notes.Where(n => n.NotebookId == notebookId);
        }
        if (request.TagId is { } tagId)
        {
            notes = notes.Where(n => n.Tags.Any(t => t.TagId == tagId));
        }

        // ONE condition per search word, chained with Where (= AND): every word must be satisfied. A word is
        // satisfied by a word of the note that starts with it (the GIN index on the tsvector) or, for words long
        // enough to have a meaningful "typo", by a similar word in the title or the content (the trigram
        // indexes). Judging the typo PER WORD matters: comparing the whole phrase would let a note that merely
        // shares most of the words match, and "alpha beta" would find "alpha gamma".
        // f_unaccent(lower(column)) is exactly the expression of the trigram indexes, so PostgreSQL can use them.
        var matching = notes;
        foreach (var term in terms)
        {
            var prefix = term + ":*";
            matching = term.Length >= SearchLimits.MinTypoTermLength
                ? matching.Where(n =>
                    EF.Property<NpgsqlTsVector>(n, NoteSearch.VectorProperty).Matches(EF.Functions.ToTsQuery("simple", SearchFunctions.Unaccent(prefix)))
                    || EF.Functions.TrigramsAreWordSimilar(term, SearchFunctions.Unaccent(n.Title.ToLower()))
                    || EF.Functions.TrigramsAreWordSimilar(term, SearchFunctions.Unaccent(n.Content.ToLower())))
                : matching.Where(n =>
                    EF.Property<NpgsqlTsVector>(n, NoteSearch.VectorProperty).Matches(EF.Functions.ToTsQuery("simple", SearchFunctions.Unaccent(prefix))));
        }

        var total = await matching.CountAsync(ct);
        if (total == 0)
        {
            return new SearchResponse([], 0, request.Page, request.PageSize);
        }

        // STEP 1: order ALL the matching notes and keep only the ids of the requested page. The score is only in
        // ORDER BY (not also in the select list, where it would be computed twice for every matching row), and it
        // is deliberately cheap: ts_rank_cd looks at how close together the words are (the weights, title A and
        // content B, are in the vector); the second term rewards a title that is similar to the query. Comparing
        // the query with the whole CONTENT would cost a lot for every matching note, so it is not part of the score.
        var pageIds = await matching
            .OrderByDescending(n =>
                EF.Property<NpgsqlTsVector>(n, NoteSearch.VectorProperty).RankCoverDensity(EF.Functions.ToTsQuery("simple", SearchFunctions.Unaccent(tsQueryText)))
                + 0.6 * EF.Functions.TrigramsWordSimilarity(phrase, SearchFunctions.Unaccent(n.Title.ToLower())))
            .ThenByDescending(n => n.UpdatedAt)
            .ThenBy(n => n.Id) // a total order: the same note never appears on two pages
            .Skip((request.Page - 1) * request.PageSize)
            .Take(request.PageSize)
            .Select(n => n.Id)
            .ToListAsync(ct);

        // STEP 2: only now read the content (a note can be huge) and only of the notes that are shown.
        var rows = await db.Notes.AsNoTracking()
            .Where(n => pageIds.Contains(n.Id))
            .Select(n => new
            {
                n.Id,
                n.Title,
                n.UpdatedAt,
                n.NotebookId,
                n.IsPinned,
                n.Status,
                TagIds = n.Tags.Select(t => t.TagId).ToList(),
                Content = n.Content.Substring(0, SearchLimits.SnippetSourceLength), // substr: shorter texts are fine
            })
            .ToListAsync(ct);
        var position = pageIds.Select((id, index) => (id, index)).ToDictionary(x => x.id, x => x.index);
        var page = rows.OrderBy(r => position[r.Id]).ToList(); // back to the ranked order

        var items = page.Select(r => new SearchResultDto(
            r.Id,
            SearchText.Highlight(r.Title, terms),
            SearchText.Snippet(r.Content, terms),
            r.UpdatedAt,
            r.NotebookId,
            r.IsPinned,
            r.Status,
            r.TagIds)).ToList();

        return new SearchResponse(items, total, request.Page, request.PageSize);
    }
}
