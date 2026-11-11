using FluentValidation;
using InkNote.Api.Modules.Sync.Application;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Persistence;

namespace InkNote.Api.Modules.Sync;

public static class SyncModule
{
    /// <summary>Registers synchronization. The handlers (one per kind of data) are registered by their own modules.</summary>
    public static IServiceCollection AddSyncModule(this IServiceCollection services)
    {
        services.AddOptions<SyncOptions>().BindConfiguration(SyncOptions.SectionName);
        services.AddScoped<SyncService>();

        // Real-time: SignalR (part of ASP.NET Core, no package) + the notifier + the interceptor that calls it
        // whenever a note, notebook or tag is saved. Both are singletons: they hold state across requests.
        services.AddSignalR();
        services.AddSingleton<ISyncNotifier, SyncNotifier>();
        services.AddSingleton<SyncNotificationInterceptor>();
        services.AddValidatorsFromAssemblyContaining<PullQueryValidator>();
        return services;
    }
}
