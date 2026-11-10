namespace InkNote.Api.Modules.Notebooks.Domain;

/// <summary>
/// A folder for notes. Notebooks form a tree: ParentId points to the parent notebook
/// (null = top level). The database stores a flat table; the client builds the tree.
/// </summary>
public sealed class Notebook
{
    private Notebook() { }

    public Guid Id { get; private set; }
    public string Name { get; private set; } = string.Empty;
    public Guid? ParentId { get; private set; }
    public DateTimeOffset CreatedAt { get; private set; }
    public DateTimeOffset UpdatedAt { get; private set; }

    public static Notebook Create(string name, Guid? parentId, DateTimeOffset now) => new()
    {
        Id = Guid.CreateVersion7(),
        Name = name,
        ParentId = parentId,
        CreatedAt = now,
        UpdatedAt = now,
    };

    public void Update(string name, Guid? parentId, DateTimeOffset now)
    {
        Name = name;
        ParentId = parentId;
        UpdatedAt = now;
    }
}
