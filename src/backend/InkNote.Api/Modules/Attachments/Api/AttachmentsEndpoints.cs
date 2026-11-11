using InkNote.Api.Modules.Attachments.Application;
using Microsoft.AspNetCore.Http.Features;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Attachments.Api;

public static class AttachmentsEndpoints
{
    public static IEndpointRouteBuilder MapAttachmentsEndpoints(this IEndpointRouteBuilder app)
    {
        var group = app.MapGroup("/api/attachments").WithTags("Attachments");

        // Upload: multipart/form-data with the fields "id" (chosen by the client, so a repeat is harmless), "noteId" and "file".
        group.MapPost("/", async (
                [FromForm] Guid id,
                [FromForm] Guid noteId,
                IFormFile file,
                AttachmentService attachments,
                CancellationToken ct) =>
            {
                await using var content = file.OpenReadStream();
                var result = await attachments.UploadAsync(id, noteId, file.FileName, content, ct);
                return result.Status switch
                {
                    UploadStatus.Created => Results.Created($"/api/attachments/{id}", result.Attachment),
                    UploadStatus.AlreadyExists => Results.Ok(result.Attachment),
                    UploadStatus.NoteNotFound => Problem(StatusCodes.Status404NotFound, "Note not found"),
                    UploadStatus.Empty => Problem(StatusCodes.Status400BadRequest, "The file is empty"),
                    UploadStatus.TooLarge => Problem(StatusCodes.Status413PayloadTooLarge, "The file is too large"),
                    UploadStatus.QuotaExceeded => Problem(StatusCodes.Status413PayloadTooLarge, "Your storage is full"),
                    UploadStatus.UnsupportedType => Problem(StatusCodes.Status415UnsupportedMediaType, "This kind of file is not allowed"),
                    _ => Problem(StatusCodes.Status500InternalServerError, "Unexpected result"),
                };
            })
            .WithName("UploadAttachment")
            .DisableAntiforgery() // the API is called with a Bearer token, not a cookie: there is nothing to forge (CSRF needs cookies)
            .AddEndpointFilter(async (context, next) =>
            {
                // Refuse an oversized request early, from the web server's own counter, before reading the file.
                // (A multipart body is a little larger than the file: boundaries and the other fields.)
                var limit = context.HttpContext.RequestServices.GetRequiredService<IOptions<AttachmentOptions>>().Value.MaxFileBytes + 64 * 1024;
                var feature = context.HttpContext.Features.Get<IHttpMaxRequestBodySizeFeature>();
                if (feature is { IsReadOnly: false })
                {
                    feature.MaxRequestBodySize = limit;
                }

                return await next(context);
            })
            .Produces<AttachmentDto>(StatusCodes.Status201Created)
            .Produces<AttachmentDto>()
            .ProducesProblem(StatusCodes.Status404NotFound)
            .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
            .ProducesProblem(StatusCodes.Status415UnsupportedMediaType);

        group.MapGet("/{id:guid}", async (Guid id, AttachmentService attachments, CancellationToken ct) =>
                await attachments.GetAsync(id, ct) is { } dto ? Results.Ok(dto) : NotFound())
            .WithName("GetAttachment")
            .Produces<AttachmentDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        // "Where can I download this?" The answer is a short-lived presigned URL, given only to the owner.
        group.MapGet("/{id:guid}/url", async (Guid id, bool? download, AttachmentService attachments, CancellationToken ct) =>
                await attachments.CreateUrlAsync(id, download ?? false, ct) is { } dto ? Results.Ok(dto) : NotFound())
            .WithName("GetAttachmentUrl")
            .Produces<AttachmentUrlDto>()
            .ProducesProblem(StatusCodes.Status404NotFound);

        group.MapDelete("/{id:guid}", async (Guid id, AttachmentService attachments, CancellationToken ct) =>
                await attachments.DeleteAsync(id, ct) ? Results.NoContent() : NotFound())
            .WithName("DeleteAttachment")
            .Produces(StatusCodes.Status204NoContent)
            .ProducesProblem(StatusCodes.Status404NotFound);

        return app;
    }

    private static IResult NotFound() => Problem(StatusCodes.Status404NotFound, "Attachment not found");

    private static IResult Problem(int status, string title) => Results.Problem(statusCode: status, title: title);
}
