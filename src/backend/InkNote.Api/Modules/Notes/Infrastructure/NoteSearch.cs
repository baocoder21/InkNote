namespace InkNote.Api.Modules.Notes.Infrastructure;

/// <summary>Names shared by the mapping (NoteConfiguration) and the search queries (NoteSearchService).</summary>
public static class NoteSearch
{
    /// <summary>The shadow property (and column "search_vector") that holds the tsvector of a note.</summary>
    public const string VectorProperty = "SearchVector";
}
