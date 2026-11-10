using FluentValidation;
using InkNote.Api.Modules.Notebooks.Application;
using InkNote.Api.Modules.Notebooks.Contracts;
using InkNote.Api.Modules.Sync.Contracts;

namespace InkNote.Api.Modules.Notebooks;

public static class NotebooksModule
{
    public static IServiceCollection AddNotebooksModule(this IServiceCollection services)
    {
        services.AddScoped<NotebookService>();
        services.AddScoped<INotebookLookup, NotebookLookup>(); // the contract other modules use
        services.AddScoped<ISyncHandler, NotebookSyncHandler>(); // lets the Sync module read and change notebooks
        services.AddValidatorsFromAssemblyContaining<CreateNotebookRequestValidator>();
        return services;
    }
}
