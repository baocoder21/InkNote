using System.Text;
using InkNote.Api.Modules.Notes.Application;

namespace InkNote.Api.Tests;

/// <summary>The pure text helpers of search: no database, no HTTP.</summary>
public sealed class SearchTextTests
{
    private static string Marked(IReadOnlyList<TextPart> parts) =>
        string.Concat(parts.Select(p => p.Match ? $"[{p.Text}]" : p.Text));

    // ---------- Normalize ----------

    [Fact]
    public void Normalize_lowercases_and_removes_accents_including_the_Vietnamese_d_with_stroke()
    {
        var (text, _) = SearchText.Normalize("Xin chào, Đường Đồng Khởi Ổn Ữ Ế");

        Assert.Equal("xin chao, duong dong khoi on u e", text);
    }

    [Fact]
    public void Normalize_maps_every_result_character_back_to_its_place_in_the_original()
    {
        var original = "Đường đi";
        var (text, map) = SearchText.Normalize(original);

        Assert.Equal(text.Length, map.Length);
        Assert.Equal("duong di", text);
        // "duong" starts at 0 and the original character there is "Đ"; the "d" of "di" is original index 6.
        Assert.Equal(0, map[0]);
        Assert.Equal(6, map[text.IndexOf("di", StringComparison.Ordinal)]);
    }

    [Fact]
    public void Normalize_treats_a_letter_written_as_base_plus_separate_accent_like_the_precomposed_one()
    {
        var decomposed = "Café".Normalize(NormalizationForm.FormD); // "e" + combining acute

        var (text, map) = SearchText.Normalize(decomposed);

        Assert.Equal("cafe", text);
        Assert.Equal(text.Length, map.Length);
    }

    [Fact]
    public void Normalize_does_not_throw_on_emoji_or_lone_surrogates()
    {
        var (text, map) = SearchText.Normalize("ok 😀 \uD83D end");

        Assert.Equal(text.Length, map.Length);
        Assert.Contains("ok", text);
        Assert.Contains("end", text);
    }

    // ---------- Terms ----------

    [Fact]
    public void Terms_are_lowercase_unaccented_words_without_duplicates()
    {
        Assert.Equal(["xin", "chao", "42"], SearchText.Terms("  Xin   CHÀO xin, 42! "));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("!!! ... ???")]
    [InlineData("& | ! ( ) : * '")]
    public void Terms_are_empty_when_there_is_nothing_searchable(string? query)
    {
        Assert.Empty(SearchText.Terms(query));
    }

    [Fact]
    public void Terms_never_contain_a_character_that_means_something_in_a_tsquery()
    {
        // The SQL attack comes first: only the first 10 words are kept.
        var terms = SearchText.Terms("'; DROP TABLE notes; -- a&b | !c (d) e:* f' g\\ <script>alert(1)</script>");

        foreach (var term in terms)
        {
            Assert.All(term, c => Assert.True(char.IsLetterOrDigit(c), $"'{c}' in '{term}'"));
        }
        Assert.Contains("drop", terms);
    }

    [Fact]
    public void Terms_are_limited_in_number_and_length()
    {
        var many = SearchText.Terms(string.Join(' ', Enumerable.Range(0, 40).Select(i => "word" + i)));
        Assert.Equal(SearchText.MaxTerms, many.Count);

        var longWord = SearchText.Terms(new string('x', 500));
        Assert.Equal(SearchText.MaxTermLength, longWord.Single().Length);
    }

    // ---------- Highlight ----------

    [Fact]
    public void Highlight_marks_words_that_start_with_a_term_and_keeps_the_original_accents()
    {
        var parts = SearchText.Highlight("Xin chào bạn, đường đi", SearchText.Terms("chao duong"));

        Assert.Equal("Xin [chào] bạn, [đường] đi", Marked(parts));
    }

    [Fact]
    public void Highlight_marks_only_the_beginning_of_a_word_not_the_middle()
    {
        Assert.Equal("[prog]ramming and [prog]ram", Marked(SearchText.Highlight("programming and program", SearchText.Terms("prog"))));
        Assert.Equal("a program", Marked(SearchText.Highlight("a program", SearchText.Terms("ram")))); // "ram" is inside the word
    }

    [Fact]
    public void Highlight_merges_overlapping_matches_into_one()
    {
        var parts = SearchText.Highlight("programming", SearchText.Terms("pro prog"));

        Assert.Equal("[prog]ramming", Marked(parts));
    }

    [Fact]
    public void Highlight_without_any_match_returns_the_text_unmarked()
    {
        var parts = SearchText.Highlight("nothing here", SearchText.Terms("zzz"));

        Assert.Single(parts);
        Assert.False(parts[0].Match);
        Assert.Equal("nothing here", parts[0].Text);
    }

    [Fact]
    public void Highlight_works_on_text_with_separate_accent_characters()
    {
        var decomposed = "Xin chào bạn".Normalize(NormalizationForm.FormD);

        var parts = SearchText.Highlight(decomposed, SearchText.Terms("chao"));

        // The accent character that follows the "a" is part of the marked word.
        Assert.Equal("Xin [chào] bạn".Normalize(NormalizationForm.FormD), Marked(parts));
    }

    [Fact]
    public void Highlight_keeps_html_as_plain_text()
    {
        var parts = SearchText.Highlight("<b>alert</b>", SearchText.Terms("alert"));

        Assert.Equal("<b>[alert]</b>", Marked(parts)); // no escaping, no markup: the client shows it as text
    }

    // ---------- Snippet ----------

    [Fact]
    public void Snippet_of_a_short_note_is_the_whole_text_with_the_match_marked()
    {
        var parts = SearchText.Snippet("Buy milk\nand   eggs", SearchText.Terms("eggs"));

        Assert.Equal("Buy milk and [eggs]", Marked(parts)); // newlines and runs of spaces became single spaces
    }

    [Fact]
    public void Snippet_is_centered_on_the_first_match_and_marks_the_cut_with_ellipses()
    {
        var content = string.Join(' ', Enumerable.Repeat("lorem ipsum dolor sit amet", 40)) + " needle " + string.Join(' ', Enumerable.Repeat("consectetur adipiscing elit", 40));

        var parts = SearchText.Snippet(content, SearchText.Terms("needle"));
        var text = string.Concat(parts.Select(p => p.Text));

        Assert.True(text.Length <= SearchText.SnippetLength + 30, $"too long: {text.Length}");
        Assert.Equal("…", parts[0].Text);
        Assert.Equal("…", parts[^1].Text);
        Assert.Contains("[needle]", Marked(parts));
    }

    [Fact]
    public void Snippet_without_a_literal_match_is_the_beginning_of_the_note()
    {
        // A typo ("meting") found the note through similarity; there is nothing to mark.
        var parts = SearchText.Snippet("Weekly meeting notes for the team", SearchText.Terms("meting"));

        Assert.Equal("Weekly meeting notes for the team", Marked(parts));
    }

    [Fact]
    public void Snippet_of_an_empty_note_is_empty()
    {
        Assert.Empty(SearchText.Snippet("  \n\t ", SearchText.Terms("a")));
    }

    [Fact]
    public void Snippet_does_not_cut_a_word_in_half_at_the_start()
    {
        var content = string.Concat(Enumerable.Repeat("abcdefghij ", 30)) + "target " + string.Concat(Enumerable.Repeat("klmnopqrst ", 30));

        var text = string.Concat(SearchText.Snippet(content, SearchText.Terms("target")).Select(p => p.Text)).TrimStart('…');

        Assert.StartsWith("abcdefghij", text); // starts at a word boundary, not at "cdefghij"
    }
}
