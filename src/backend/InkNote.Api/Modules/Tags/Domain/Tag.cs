namespace InkNote.Api.Modules.Tags.Domain;

/// <summary>
/// A label that can be attached to many notes. Names are unique ignoring case:
/// "Work" and "work" are the same tag. NormalizedName holds the comparable form
/// and carries the unique index.
/// </summary>
public sealed class Tag
{
    private Tag() { }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public string NormalizedName { get; private set; } = string.Empty;
    public DateTimeOffset CreatedAt { get; private set; }

    public static string Normalize(string name) => name.Trim().ToUpperInvariant();

    public static Tag Create(string name, DateTimeOffset now)
    {
        var trimmed = name.Trim();
        return new Tag
        {
            Id = Guid.CreateVersion7(),
            Name = trimmed,
            NormalizedName = Normalize(trimmed),
            CreatedAt = now,
        };
    }

    public void Rename(string name)
    {
        Name = name.Trim();
        NormalizedName = Normalize(Name);
    }
}
