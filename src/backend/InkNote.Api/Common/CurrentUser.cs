using System.Security.Claims;

namespace InkNote.Api.Common;

/// <summary>
/// "Who is making this request?" Every module that stores per-user data asks this one small
/// interface, so none of them has to know about JWTs, claims or HttpContext (and tests can
/// replace it).
/// </summary>
public interface ICurrentUser
{
    /// <summary>The id of the signed-in user, or null when the request is anonymous.</summary>
    Guid? UserId { get; }

    /// <summary>The id of the signed-in user; throws when there is none (a bug: the endpoint must require sign-in).</summary>
    Guid RequiredUserId { get; }
}

/// <summary>Reads the user id from the "sub" claim of the validated access token.</summary>
public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    /// <summary>Name of the JWT claim that carries the user id ("subject").</summary>
    public const string SubjectClaim = "sub";

    public Guid? UserId =>
        Guid.TryParse(accessor.HttpContext?.User.FindFirstValue(SubjectClaim), out var id) ? id : null;

    public Guid RequiredUserId =>
        UserId ?? throw new InvalidOperationException("This code needs a signed-in user, but the request is anonymous.");
}
