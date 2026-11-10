using FluentValidation;
using InkNote.Api.Modules.Notebooks.Application;

namespace InkNote.Api.Modules.Notebooks.Api;

public static class NotebooksEndpoints
{
    public static IEndpointRouteBuilder MapNotebooksEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/notebooks").WithTags("Notebooks");

        group.MapGet("/", async (NotebookService notebooks, CancellationToken ct) =>
                Results.Ok(await notebooks.ListAsync(ct)))
            .WithName("ListNotebooks")
            .Produces<IReadOnlyList<NotebookDto>>();

        group.MapPost("/", async (
                CreateNotebookRequest request,
                IValidator<CreateNotebookRequest> validator,
                NotebookService notebooks,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var result = await notebooks.CreateAsync(request, ct);
                return result.Status == NotebookStatus.Ok
                    ? Results.Created($"/api/notebooks/{result.Notebook!.Id}", result.Notebook)
                    : ToProblem(result);
            })
            .WithName("CreateNotebook")
            .Produces<NotebookDto>(StatusCodes.Status201Created)
            .ProducesValidationProblem();

        group.MapPut("/{id:guid}", async (
                Guid id,
                UpdateNotebookRequest request,
                IValidator<UpdateNotebookRequest> validator,
                NotebookService notebooks,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var result = await notebooks.UpdateAsync(id, request, ct);
                return result.Status == NotebookStatus.Ok ? Results.Ok(result.Notebook) : ToProblem(result);
            })
            .WithName("UpdateNotebook")
            .Produces<NotebookDto>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapDelete("/{id:guid}", async (Guid id, NotebookService notebooks, CancellationToken ct) =>
            {
                var result = await notebooks.DeleteAsync(id, ct);
                return result.Status == NotebookStatus.Ok ? Results.NoContent() : ToProblem(result);
            })
            .WithName("DeleteNotebook")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        return app;
    }

    // Maps a service outcome to the HTTP error that describes it (ProblemDetails body).
    private static IResult ToProblem(NotebookResult result) => result.Status switch
    {
        NotebookStatus.NotFound => Results.Problem(
            statusCode: StatusCodes.Status404NotFound, title: "Notebook not found"),
        NotebookStatus.InvalidParent => Results.ValidationProblem(
            new Dictionary<string, string[]> { ["parentId"] = [result.Message!] }),
        NotebookStatus.NotEmpty => Results.Problem(
            statusCode: StatusCodes.Status409Conflict, title: "Notebook is not empty", detail: result.Message),
        _ => throw new InvalidOperationException($"Unhandled status {result.Status}"),
    };
}
