using FluentValidation;

namespace InkNote.Api.Modules.Auth.Application;

public static class AuthLimits
{
    public const int EmailMaxLength = 256;

    // Passwords are hashed with a deliberately slow function, so an enormous password would be a
    // cheap way to burn server time. The minimum length is Identity's job (see AuthModule).
    public const int PasswordMaxLength = 128;
}

// RememberMe: true = keep the user signed in for days (persistent cookie, long refresh token);
// false = only for this browser session (cookie dies when the browser closes, short refresh token).
public sealed record RegisterRequest(string Email, string Password, bool RememberMe = false);

public sealed record LoginRequest(string Email, string Password, bool RememberMe = false);

public sealed record AuthUserDto(Guid Id, string Email);

/// <summary>
/// What sign-in, register and refresh answer with. The access token is in the body (the client
/// keeps it in memory); the refresh token is NOT here: it travels in an HttpOnly cookie.
/// </summary>
public sealed record AuthResponse(string AccessToken, int ExpiresInSeconds, AuthUserDto User);

public sealed class RegisterRequestValidator : AbstractValidator<RegisterRequest>
{
    public RegisterRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(AuthLimits.EmailMaxLength).EmailAddress();
        RuleFor(x => x.Password).NotEmpty().MaximumLength(AuthLimits.PasswordMaxLength);
    }
}

public sealed class LoginRequestValidator : AbstractValidator<LoginRequest>
{
    public LoginRequestValidator()
    {
        RuleFor(x => x.Email).NotEmpty().MaximumLength(AuthLimits.EmailMaxLength);
        RuleFor(x => x.Password).NotEmpty().MaximumLength(AuthLimits.PasswordMaxLength);
    }
}
