using System.Security.Claims;
using FluentValidation;
using InkNote.Api.Common;
using InkNote.Api.Modules.Auth.Application;

namespace InkNote.Api.Modules.Auth.Api;

public static class AuthEndpoints
{
    /// <summary>Name of the rate-limiting policy applied to register / login / refresh.</summary>
    public const string RateLimitPolicy = "auth";

    public static IEndpointRouteBuilder MapAuthEndpoints(this IEndpointRouteBuilder app)
    {
        // Everything is open to anonymous callers (you cannot sign in while already signed in),
        // but limited per IP address so passwords cannot be guessed at full speed.
        var group = app.MapGroup("/api/auth")
            .WithTags("Auth")
            .AllowAnonymous()
            .RequireRateLimiting(RateLimitPolicy);

        group.MapPost("/register", async (
                RegisterRequest request,
                IValidator<RegisterRequest> validator,
                AuthService auth,
                HttpContext http,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var outcome = await auth.RegisterAsync(request, ct);
                return outcome.Status switch
                {
                    AuthStatus.Ok => Signed(http, outcome, created: true),
                    AuthStatus.Duplicate => Results.Problem(
                        statusCode: StatusCodes.Status409Conflict,
                        title: "An account with this email already exists."),
                    _ => Results.ValidationProblem(outcome.Errors!.ToDictionary(e => e.Key, e => e.Value)),
                };
            })
            .WithName("Register")
            .Produces<AuthResponse>(StatusCodes.Status201Created)
            .ProducesValidationProblem()
            .ProducesProblem(StatusCodes.Status409Conflict);

        group.MapPost("/login", async (
                LoginRequest request,
                IValidator<LoginRequest> validator,
                AuthService auth,
                HttpContext http,
                CancellationToken ct) =>
            {
                var validation = await validator.ValidateAsync(request, ct);
                if (!validation.IsValid)
                {
                    return Results.ValidationProblem(validation.ToDictionary());
                }

                var outcome = await auth.LoginAsync(request, ct);
                return outcome.Status switch
                {
                    AuthStatus.Ok => Signed(http, outcome, created: false),
                    AuthStatus.LockedOut => Results.Problem(
                        statusCode: StatusCodes.Status429TooManyRequests,
                        title: "Too many failed attempts. Try again in a few minutes."),
                    // The same answer whether the email or the password was wrong.
                    _ => Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "Invalid email or password."),
                };
            })
            .WithName("Login")
            .Produces<AuthResponse>()
            .ProducesProblem(StatusCodes.Status401Unauthorized)
            .ProducesProblem(StatusCodes.Status429TooManyRequests);

        // No body: the refresh token comes from the HttpOnly cookie, which JavaScript cannot read.
        group.MapPost("/refresh", async (AuthService auth, HttpContext http, CancellationToken ct) =>
            {
                var outcome = await auth.RefreshAsync(RefreshCookie.Read(http.Request), ct);
                if (outcome.Status != AuthStatus.Ok)
                {
                    RefreshCookie.Clear(http);
                    return Results.Problem(statusCode: StatusCodes.Status401Unauthorized, title: "The session has expired. Sign in again.");
                }

                return Signed(http, outcome, created: false);
            })
            .WithName("RefreshSession")
            .Produces<AuthResponse>()
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        group.MapPost("/logout", async (AuthService auth, HttpContext http, CancellationToken ct) =>
            {
                await auth.LogoutAsync(RefreshCookie.Read(http.Request), ct);
                RefreshCookie.Clear(http);
                return Results.NoContent();
            })
            .WithName("Logout")
            .Produces(StatusCodes.Status204NoContent);

        // The only endpoint here that REQUIRES sign-in (the app-wide default): "who am I?".
        app.MapGet("/api/auth/me", (ClaimsPrincipal user, ICurrentUser current) =>
                Results.Ok(new AuthUserDto(current.RequiredUserId, user.FindFirstValue("email") ?? string.Empty)))
            .WithTags("Auth")
            .WithName("Me")
            .Produces<AuthUserDto>()
            .ProducesProblem(StatusCodes.Status401Unauthorized);

        return app;
    }

    /// <summary>Puts the refresh token in its cookie and answers with the access token in the body.</summary>
    private static IResult Signed(HttpContext http, AuthOutcome outcome, bool created)
    {
        RefreshCookie.Write(http, outcome.Refresh!);
        return created
            ? Results.Created("/api/auth/me", outcome.Response)
            : Results.Ok(outcome.Response);
    }
}

/// <summary>
/// The refresh token's cookie. HttpOnly: scripts cannot read it, so a cross-site-scripting bug cannot steal it.
/// Path /api/auth: the browser sends it only to the auth endpoints, not with every note request.
/// SameSite=Lax: other websites cannot make the browser send it along with their requests.
/// "Remember me" decides the cookie's lifetime: with it the cookie has an expiry date (it survives closing
/// the browser); without it it is a SESSION cookie, which the browser deletes when it closes.
/// Secure: only over HTTPS (switched on automatically when the request itself is HTTPS).
/// </summary>
internal static class RefreshCookie
{
    public const string Name = "inknote_refresh";
    private const string CookiePath = "/api/auth";

    public static string? Read(HttpRequest request) => request.Cookies[Name];

    public static void Write(HttpContext http, IssuedRefreshToken token) =>
        http.Response.Cookies.Append(Name, token.Token, Options(http, token.Persistent ? token.ExpiresAt : null));

    public static void Clear(HttpContext http) =>
        http.Response.Cookies.Delete(Name, Options(http, expires: null));

    private static CookieOptions Options(HttpContext http, DateTimeOffset? expires) => new()
    {
        HttpOnly = true,
        Secure = http.Request.IsHttps,
        SameSite = SameSiteMode.Lax,
        Path = CookiePath,
        Expires = expires,
        IsEssential = true,
    };
}
