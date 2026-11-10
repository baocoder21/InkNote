using FluentValidation;
using InkNote.Api.Modules.Notes.Application;

namespace InkNote.Api.Modules.Notes.Api;

public static class NotesEndpoints
{
    public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder app)
    {
        // A group shares the route prefix and metadata for all its endpoints.
        var group = app.MapGroup("/api/notes").WithTags("Notes");

        // Optional filters come from the query string: /api/notes?notebookId=...&tagId=...
        group.MapGet("/", async (Guid? notebookId, Guid? tagId, NoteService notes, CancellationToken ct) =>
                Results.Ok(await notes.ListAsync(notebookId, tagId, ct)))
            .WithName("ListNotes")
            .Produces<IReadOnlyList<NoteSummaryDto>>();

        group.MapGet("/{id:guid}", async (Guid id, NoteService notes, CancellationToken ct) =>
                await notes.GetAsync(id, ct) is { } note ? Results.Ok(note) : NotFound())
            .WithName("GetNote")
            .Produces<NoteDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapPost("/", async (
                CreateNoteRequest request,
                IValidator<CreateNoteRequest> validator,
                NoteService notes,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var result = await notes.CreateAsync(request, ct);
                return result.Note is { } note
                    ? Results.Created($"/api/notes/{note.Id}", note)
                    : InvalidReference(result.ErrorField!, result.ErrorMessage!);
            })
            .WithName("CreateNote")
            .Produces<NoteDto>(StatusCodes.Status201Created)
            .ProducesValidationProblem();

        group.MapPut("/{id:guid}", async (
                Guid id,
                UpdateNoteRequest request,
                IValidator<UpdateNoteRequest> validator,
                NoteService notes,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                return ToResult(await notes.UpdateAsync(id, request, ct));
            })
            .WithName("UpdateNote")
            .Produces<NoteDto>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        // Notebook, pin and tags: a separate "sub-resource" so autosave of the content never touches them.
        group.MapPut("/{id:guid}/organization", async (
                Guid id,
                UpdateNoteOrganizationRequest request,
                IValidator<UpdateNoteOrganizationRequest> validator,
                NoteService notes,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                return ToResult(await notes.UpdateOrganizationAsync(id, request, ct));
            })
            .WithName("UpdateNoteOrganization")
            .Produces<NoteDto>()
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapDelete("/{id:guid}", async (Guid id, NoteService notes, CancellationToken ct) =>
                await notes.DeleteAsync(id, ct) ? Results.NoContent() : NotFound())
            .WithName("DeleteNote")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }

    // Shared by both PUT endpoints: maps a service outcome to an HTTP response.
    private static IResult ToResult(UpdateNoteResult result) => result.Status switch
    {
        UpdateNoteStatus.Updated => Results.Ok(result.Note),
        UpdateNoteStatus.NotFound => NotFound(),
        UpdateNoteStatus.InvalidReference => InvalidReference(result.ErrorField!, result.ErrorMessage!),
        _ => Results.Problem(
            statusCode: StatusCodes.Status409Conflict,
            title: "Version conflict",
            detail: "The note was changed by someone else. Reload it and try again."),
    };

    private static IResult InvalidReference(string field, string message) =>
        Results.ValidationProblem(new Dictionary<string, string[]> { [field] = [message] });

    // Errors are returned as ProblemDetails (RFC 9457), a standard JSON error shape.
    private static IResult NotFound() =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Note not found");
}
