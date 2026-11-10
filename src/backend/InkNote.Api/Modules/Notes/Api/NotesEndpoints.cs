using FluentValidation;
using InkNote.Api.Modules.Notes.Application;

namespace InkNote.Api.Modules.Notes.Api;

public static class NotesEndpoints
{
    public static IEndpointRouteBuilder MapNotesEndpoints(this IEndpointRouteBuilder app)
    {
        // A group shares the route prefix and metadata for all its endpoints.
        var group = app.MapGroup("/api/notes").WithTags("Notes");

        group.MapGet("/", async (NoteService notes, CancellationToken ct) =>
                Results.Ok(await notes.ListAsync(ct)))
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

                var note = await notes.CreateAsync(request, ct);
                return Results.Created($"/api/notes/{note.Id}", note);
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

                var result = await notes.UpdateAsync(id, request, ct);
                return result.Status switch
                {
                    UpdateNoteStatus.Updated => Results.Ok(result.Note),
                    UpdateNoteStatus.NotFound => NotFound(),
                    _ => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict,
                        title: "Version conflict",
                        detail: "The note was changed by someone else. Reload it and try again."),
                };
            })
            .WithName("UpdateNote")
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

    // Errors are returned as ProblemDetails (RFC 9457), a standard JSON error shape.
    private static IResult NotFound() =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Note not found");
}
