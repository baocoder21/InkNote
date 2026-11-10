using FluentValidation;
using InkNote.Api.Modules.Tags.Application;
using InkNote.Api.Modules.Tags.Contracts;

namespace InkNote.Api.Modules.Tags;

public static class TagsModule
{
    public static IServiceCollection AddTagsModule(this IServiceCollection services)
    {
        services.AddScoped<TagService>();
        services.AddScoped<ITagLookup, TagLookup>();
        services.AddValidatorsFromAssemblyContaining<CreateTagRequestValidator>();
        return services;
    }
}
