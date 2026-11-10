using FluentValidation;
using InkNote.Api.Modules.Tags.Application;

namespace InkNote.Api.Modules.Tags.Api;

public static class TagsEndpoints
{
    public static IEndpointRouteBuilder MapTagsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/tags").WithTags("Tags");

        group.MapGet("/", async (TagService tags, CancellationToken ct) =>
                Results.Ok(await tags.ListAsync(ct)))
            .WithName("ListTags")
            .Produces<IReadOnlyList<TagDto>>();

        group.MapPost("/", async (
                CreateTagRequest request,
                IValidator<CreateTagRequest> validator,
                TagService tags,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var result = await tags.CreateAsync(request, ct);
                return result.Status == TagStatus.Ok
                    ? Results.Created($"/api/tags/{result.Tag!.Id}", result.Tag)
                    : ToProblem(result);
            })
            .WithName("CreateTag")
            .Produces<TagDto>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapPut("/{id:guid}", async (
                Guid id,
                UpdateTagRequest request,
                IValidator<UpdateTagRequest> validator,
                TagService tags,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var result = await tags.RenameAsync(id, request, ct);
                return result.Status == TagStatus.Ok ? Results.Ok(result.Tag) : ToProblem(result);
            })
            .WithName("RenameTag")
            .Produces<TagDto>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapDelete("/{id:guid}", async (Guid id, TagService tags, CancellationToken ct) =>
                await tags.DeleteAsync(id, ct)
                    ? Results.NoContent()
                    : Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Tag not found"))
            .WithName("DeleteTag")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }

    private static IResult ToProblem(TagResult result) => result.Status switch
    {
        TagStatus.NotFound => Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Tag not found"),
        TagStatus.Duplicate => Results.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "Tag already exists",
            detail: "A tag with this name already exists (names are not case-sensitive)."),
        _ => throw new InvalidOperationException($"Unhandled status {result.Status}"),
    };
}
