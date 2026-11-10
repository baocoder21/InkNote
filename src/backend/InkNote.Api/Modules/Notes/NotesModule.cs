using FluentValidation;
using InkNote.Api.Modules.Notes.Application;

namespace InkNote.Api.Modules.Notes;

public static class NotesModule
{
    /// <summary>Registers everything the Notes module needs in the DI container.</summary>
    public static IServiceCollection AddNotesModule(this IServiceCollection services)
    {
        services.AddScoped<NoteService>(); // one instance per HTTP request
        services.AddValidatorsFromAssemblyContaining<CreateNoteRequestValidator>();
        return services;
    }
}
