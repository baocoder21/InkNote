using InkNote.Api.Modules.Tags.Domain;

namespace InkNote.Api.Modules.Tags.Application;

public sealed record TagDto(Guid Id, string Name)
{
    public static TagDto From(Tag tag) => new(tag.Id, tag.Name);
}

public sealed record CreateTagRequest(string Name);

public sealed record UpdateTagRequest(string Name);
