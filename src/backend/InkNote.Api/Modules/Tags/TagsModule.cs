using FluentValidation;
using InkNote.Api.Modules.Tags.Application;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Modules.Tags.Contracts;

namespace InkNote.Api.Modules.Tags;

public static class TagsModule
{
    public static IServiceCollection AddTagsModule(this IServiceCollection services)
    {
        services.AddScoped<TagService>();
        services.AddScoped<ITagLookup, TagLookup>();
        services.AddScoped<ISyncHandler, TagSyncHandler>(); // lets the Sync module read and change tags
        services.AddValidatorsFromAssemblyContaining<CreateTagRequestValidator>();
        return services;
    }
}
