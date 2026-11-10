using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace InkNote.Api.Modules.Notes.Application;

/// <summary>
/// A piece of text and whether it matched the search words. The API sends results as a list of
/// these instead of HTML, so the client can mark the matches with a plain element and never needs
/// innerHTML (which is allowed only for the sanitized Markdown preview).
/// </summary>
public sealed record TextPart(string Text, bool Match);

/// <summary>
/// Pure text helpers for search: split a query into words, and cut a short, highlighted excerpt out of a
/// note. The database finds and ranks the notes; this only decides what to SHOW.
/// </summary>
public static partial class SearchText
{
    public const int MaxTerms = 10;
    public const int MaxTermLength = 50;
    public const int SnippetLength = 180;

    [GeneratedRegex(@"[\p{L}\p{N}]+")]
    private static partial Regex WordRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    /// <summary>
    /// Lowercases and removes accents ("Đường Ổn" becomes "duong on"). For every character of the result it also
    /// returns where that character is in the ORIGINAL text, so a match found in the plain text can be
    /// highlighted in the accented one. Each original character becomes zero or more result characters
    /// (a lone accent mark becomes none), hence the map.
    /// </summary>
    public static (string Text, int[] Map) Normalize(string text)
    {
        var result = new StringBuilder(text.Length);
        var map = new List<int>(text.Length);
        for (var i = 0; i < text.Length; i++)
        {
            var c = text[i];
            if (c is 'đ' or 'Đ')
            {
                result.Append('d'); // not a letter + accent in Unicode, so decomposition would not catch it
                map.Add(i);
            }
            else if (char.IsSurrogate(c))
            {
                result.Append(c); // half of an emoji etc.: keep as is (Normalize would throw on a lone surrogate)
                map.Add(i);
            }
            else
            {
                foreach (var d in c.ToString().Normalize(NormalizationForm.FormD))
                {
                    if (CharUnicodeInfo.GetUnicodeCategory(d) == UnicodeCategory.NonSpacingMark)
                    {
                        continue; // the accent itself
                    }
                    result.Append(char.ToLowerInvariant(d));
                    map.Add(i);
                }
            }
        }

        return (result.ToString(), [.. map]);
    }

    /// <summary>
    /// The words of a query: lowercase, without accents, letters and digits only, at most 10 words of 50
    /// characters. Letters and digits only is also what makes it safe to build a tsquery from them: none of the
    /// operator characters (&amp; | ! ( ) : * ') can get through.
    /// </summary>
    public static IReadOnlyList<string> Terms(string? query) =>
        string.IsNullOrWhiteSpace(query)
            ? []
            : WordRegex().Matches(Normalize(query).Text)
                .Select(m => m.Value.Length > MaxTermLength ? m.Value[..MaxTermLength] : m.Value)
                .Distinct()
                .Take(MaxTerms)
                .ToList();

    /// <summary>The whole text, cut into parts, with the words that start with a search word marked.</summary>
    public static IReadOnlyList<TextPart> Highlight(string text, IReadOnlyList<string> terms) =>
        Cut(text, 0, text.Length, MatchRanges(text, terms), ellipsisBefore: false, ellipsisAfter: false);

    /// <summary>
    /// About <see cref="SnippetLength"/> characters of the content, around the first match (or its beginning
    /// when nothing matches literally, e.g. a typo), whitespace collapsed to single spaces.
    /// </summary>
    public static IReadOnlyList<TextPart> Snippet(string content, IReadOnlyList<string> terms)
    {
        var flat = WhitespaceRegex().Replace(content, " ").Trim();
        if (flat.Length == 0)
        {
            return [];
        }

        var ranges = MatchRanges(flat, terms);
        var start = ranges.Count > 0 ? Math.Max(0, ranges[0].Start - 50) : 0;
        var end = Math.Min(flat.Length, start + SnippetLength);

        // Do not start or end in the middle of a word (when a space is close by).
        if (start > 0)
        {
            var space = flat.IndexOf(' ', start, Math.Min(20, flat.Length - start));
            if (space >= 0) start = space + 1;
        }
        if (end < flat.Length)
        {
            var space = flat.LastIndexOf(' ', end - 1, Math.Min(20, end - start));
            if (space > start) end = space;
        }

        return Cut(flat, start, end, ranges, ellipsisBefore: start > 0, ellipsisAfter: end < flat.Length);
    }

    /// <summary>Where (in the ORIGINAL text) a word starts with one of the terms. Sorted, not overlapping.</summary>
    private static List<(int Start, int End)> MatchRanges(string text, IReadOnlyList<string> terms)
    {
        var found = new List<(int Start, int End)>();
        if (terms.Count == 0 || text.Length == 0)
        {
            return found;
        }

        var (plain, map) = Normalize(text);
        foreach (var term in terms)
        {
            for (var i = plain.IndexOf(term, StringComparison.Ordinal); i >= 0; i = plain.IndexOf(term, i + 1, StringComparison.Ordinal))
            {
                // Only at the beginning of a word: the search is "starts with" (as you type).
                if (i > 0 && char.IsLetterOrDigit(plain[i - 1]))
                {
                    continue;
                }

                var start = map[i];
                var end = map[i + term.Length - 1] + 1;
                // A letter written as base + separate accent characters: take the accents along.
                while (end < text.Length && CharUnicodeInfo.GetUnicodeCategory(text[end]) == UnicodeCategory.NonSpacingMark)
                {
                    end++;
                }
                found.Add((start, end));
            }
        }

        // Merge overlapping or touching ranges, so each stretch is marked once.
        found.Sort();
        var merged = new List<(int Start, int End)>();
        foreach (var range in found)
        {
            if (merged.Count > 0 && range.Start <= merged[^1].End)
            {
                merged[^1] = (merged[^1].Start, Math.Max(merged[^1].End, range.End));
            }
            else
            {
                merged.Add(range);
            }
        }

        return merged;
    }

    private static List<TextPart> Cut(string text, int start, int end, List<(int Start, int End)> ranges, bool ellipsisBefore, bool ellipsisAfter)
    {
        var parts = new List<TextPart>();
        if (ellipsisBefore)
        {
            parts.Add(new TextPart("…", false));
        }

        var position = start;
        foreach (var (rangeStart, rangeEnd) in ranges)
        {
            var from = Math.Max(rangeStart, start);
            var to = Math.Min(rangeEnd, end);
            if (to <= from)
            {
                continue; // outside the window
            }
            if (from > position)
            {
                parts.Add(new TextPart(text[position..from], false));
            }
            parts.Add(new TextPart(text[from..to], true));
            position = to;
        }

        if (position < end)
        {
            parts.Add(new TextPart(text[position..end], false));
        }
        if (ellipsisAfter)
        {
            parts.Add(new TextPart("…", false));
        }

        return parts;
    }
}
