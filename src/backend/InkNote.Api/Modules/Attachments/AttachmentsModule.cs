using InkNote.Api.Common.Storage;
using InkNote.Api.Modules.Attachments.Application;
using InkNote.Api.Modules.Attachments.Contracts;

namespace InkNote.Api.Modules.Attachments;

public static class AttachmentsModule
{
    /// <summary>Registers attachments and the object storage they use.</summary>
    public static IServiceCollection AddAttachmentsModule(this IServiceCollection services)
    {
        services.AddOptions<AttachmentOptions>().BindConfiguration(AttachmentOptions.SectionName);
        services.AddOptions<StorageOptions>().BindConfiguration(StorageOptions.SectionName);

        // One instance for the whole application: it holds the S3 clients, which are meant to be reused.
        services.AddSingleton<IObjectStorage, S3ObjectStorage>();
        services.AddHostedService<StorageBucketInitializer>();

        services.AddScoped<AttachmentService>();
        services.AddScoped<IAttachmentCleanup>(sp => sp.GetRequiredService<AttachmentService>()); // the contract the Notes module uses
        return services;
    }
}
