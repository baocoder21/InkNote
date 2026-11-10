using FluentValidation;
using InkNote.Api.Modules.Sync.Application;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Sync.Api;

public static class SyncEndpoints
{
    public static IEndpointRouteBuilder MapSyncEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/sync").WithTags("Sync");

        // "What happened since position N?" The answer carries the new position to ask from next time.
        group.MapGet("/pull", async (
                [AsParameters] PullQuery query,
                IValidator<PullQuery> validator,
                SyncService sync,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(query, ct);
                return validation.IsValid
                    ? Results.Ok(await sync.PullAsync(query.Cursor, query.Limit, ct))
                    : Results.ValidationProblem(validation.ToDictionary());
            })
            .WithName("SyncPull")
            .Produces<PullResponse>()
            .ProducesValidationProblem();

        // "Here are the changes I made." One answer per operation, in the same order.
        group.MapPost("/push", async (
                PushRequest request,
                SyncService sync,
                IOptions<SyncOptions> options,
                CancellationToken ct) =>
            {
                var operations = request.Operations;
                if (operations is null || operations.Count == 0 || operations.Count > options.Value.MaxOperationsPerPush)
                {
                    return Results.ValidationProblem(new Dictionary<string, string[]>
                    {
                        ["operations"] = [$"Send between 1 and {options.Value.MaxOperationsPerPush} operations."],
                    });
                }

                return Results.Ok(await sync.PushAsync(operations, ct));
            })
            .WithName("SyncPush")
            .Produces<PushResponse>()
            .ProducesValidationProblem();

        return app;
    }
}
