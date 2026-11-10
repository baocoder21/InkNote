using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace InkNote.Api.Http;

/// <summary>
/// Turns "the request itself is unreadable" (malformed JSON, a value of the wrong type, an
/// unknown enum name...) into 400 instead of 500. ASP.NET Core reports those cases by throwing
/// BadHttpRequestException while binding the body; without this handler UseExceptionHandler()
/// would answer 500 and make a client mistake look like a server bug.
/// </summary>
public sealed class BadRequestExceptionHandler(IProblemDetailsService problemDetails) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        if (exception is not BadHttpRequestException)
        {
            return false; // not ours: the default handler answers 500
        }

        context.Response.StatusCode = StatusCodes.Status400BadRequest;
        return await problemDetails.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails = new ProblemDetails
            {
                Status = StatusCodes.Status400BadRequest,
                Title = "The request body could not be read.",
                // Deliberately not bad.Message: it can echo parts of what the client sent.
                Detail = "Check the JSON syntax and that every value has the expected type.",
            },
        });
    }
}
