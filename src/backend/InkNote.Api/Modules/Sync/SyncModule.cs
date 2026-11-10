using FluentValidation;
using InkNote.Api.Modules.Sync.Application;

namespace InkNote.Api.Modules.Sync;

public static class SyncModule
{
    /// <summary>Registers synchronization. The handlers (one per kind of data) are registered by their own modules.</summary>
    public static IServiceCollection AddSyncModule(this IServiceCollection services)
    {
        services.AddOptions<SyncOptions>().BindConfiguration(SyncOptions.SectionName);
        services.AddScoped<SyncService>();
        services.AddValidatorsFromAssemblyContaining<PullQueryValidator>();
        return services;
    }
}
