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

        // Full-text search. "search" is a fixed word and ids must be Guids, so it is never taken for a note id.
        group.MapGet("/search", async (
                [AsParameters] SearchQuery query,
                IValidator<SearchQuery> validator,
                NoteSearchService search,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(query, ct);
                return validation.IsValid
                    ? Results.Ok(await search.SearchAsync(query, ct))
                    : Results.ValidationProblem(validation.ToDictionary());
            })
            .WithName("SearchNotes")
            .Produces<SearchResponse>()
            .ProducesValidationProblem();

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

        // ---- Trash: a collection of its own. "trash" is a fixed word, and ids must be Guids
        // ({id:guid}), so "/api/notes/trash" can never be mistaken for a note id. ----
        group.MapGet("/trash", async (NoteService notes, CancellationToken ct) =>
                Results.Ok(await notes.ListTrashAsync(ct)))
            .WithName("ListTrash")
            .Produces<IReadOnlyList<NoteSummaryDto>>();

        group.MapGet("/trash/{id:guid}", async (Guid id, NoteService notes, CancellationToken ct) =>
                await notes.GetTrashedAsync(id, ct) is { } note ? Results.Ok(note) : NotFoundInTrash())
            .WithName("GetTrashedNote")
            .Produces<NoteDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapPost("/trash/{id:guid}/restore", async (Guid id, NoteService notes, CancellationToken ct) =>
                await notes.RestoreAsync(id, ct) is { } note ? Results.Ok(note) : NotFoundInTrash())
            .WithName("RestoreNote")
            .Produces<NoteDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        // Permanent: the row is removed from the database. Only for notes that are in the trash.
        group.MapDelete("/trash/{id:guid}", async (Guid id, NoteService notes, CancellationToken ct) =>
                await notes.PurgeAsync(id, ct) ? Results.NoContent() : NotFoundInTrash())
            .WithName("PurgeNote")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapDelete("/trash", async (NoteService notes, CancellationToken ct) =>
                Results.Ok(new EmptyTrashResult(await notes.EmptyTrashAsync(ct))))
            .WithName("EmptyTrash")
            .Produces<EmptyTrashResult>();

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

    private static IResult NotFoundInTrash() =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Note not found in the trash");

    // Errors are returned as ProblemDetails (RFC 9457), a standard JSON error shape.
    private static IResult NotFound() =>
        Results.Problem(statusCode: StatusCodes.Status404NotFound, title: "Note not found");
}
