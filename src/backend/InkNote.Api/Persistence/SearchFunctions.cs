namespace InkNote.Api.Persistence;

/// <summary>
/// Database functions that LINQ queries may call. The C# methods are never executed: EF Core sees the
/// call inside a query and writes the mapped SQL function instead (see AppDbContext.OnModelCreating).
/// </summary>
public static class SearchFunctions
{
    /// <summary>
    /// "f_unaccent(text)": removes accents ("Xin chào, đường" becomes "Xin chao, duong"). It wraps
    /// PostgreSQL's own unaccent() in an IMMUTABLE function, which is what lets the database use it
    /// in a generated column and in an index (unaccent itself is only STABLE). The function is created by
    /// the migration "AddFullTextSearch".
    /// </summary>
    public static string Unaccent(string text) =>
        throw new NotSupportedException("Only usable inside a LINQ query: it is translated to SQL.");
}
