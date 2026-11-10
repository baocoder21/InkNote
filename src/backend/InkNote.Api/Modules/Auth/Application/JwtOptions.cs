using System.Text;

namespace InkNote.Api.Modules.Auth.Application;

/// <summary>
/// Settings under "Jwt" in configuration. Only <see cref="Key"/> is secret: it lives in
/// user-secrets in development (never in the repository) and in an environment variable in production.
/// </summary>
public sealed class JwtOptions
{
    public const string SectionName = "Jwt";

    /// <summary>The secret that signs access tokens. At least 32 bytes (HS256 needs 256 bits).</summary>
    public string Key { get; set; } = string.Empty;

    public string Issuer { get; set; } = "inknote-api";
    public string Audience { get; set; } = "inknote-web";

    /// <summary>How long an access token is valid. Short on purpose: it cannot be revoked once issued.</summary>
    public TimeSpan AccessTokenLifetime { get; set; } = TimeSpan.FromMinutes(15);

    /// <summary>How long a "remember me" refresh token is valid (sliding: every use issues a new one).</summary>
    public TimeSpan RefreshTokenLifetime { get; set; } = TimeSpan.FromDays(30);

    /// <summary>
    /// How long a refresh token is valid when the user did NOT ask to be remembered. The browser drops
    /// that cookie when it closes; this limit also ends sessions of browsers that are never closed,
    /// and protects against a copied cookie.
    /// </summary>
    public TimeSpan SessionRefreshTokenLifetime { get; set; } = TimeSpan.FromHours(12);

    public TimeSpan RefreshLifetimeFor(bool persistent) => persistent ? RefreshTokenLifetime : SessionRefreshTokenLifetime;

    /// <summary>Tolerated difference between the clocks of the servers that issue and check tokens.</summary>
    public TimeSpan ClockSkew { get; set; } = TimeSpan.FromSeconds(30);

    /// <summary>
    /// If a refresh token that was ALREADY rotated is presented within this time, it is refused
    /// but the family is not revoked: two browser tabs refreshing at the same moment is normal,
    /// not theft. Later reuse is treated as theft.
    /// </summary>
    public TimeSpan RefreshReuseGrace { get; set; } = TimeSpan.FromSeconds(10);

    public byte[] KeyBytes => Encoding.UTF8.GetBytes(Key);

    /// <returns>An error message, or null when the settings are usable.</returns>
    public string? Validate() =>
        Encoding.UTF8.GetByteCount(Key) < 32
            ? "Missing or too short 'Jwt:Key' (needs at least 32 characters). In development run: " +
              "dotnet user-secrets set \"Jwt:Key\" \"<a long random string>\" (see docs/LEARNING.md, Phase 5)."
            : null;
}

/// <summary>Settings under "RateLimiting": how many sign-in style requests one IP address may make.</summary>
public sealed class AuthRateLimitOptions
{
    public const string SectionName = "RateLimiting";

    /// <summary>Requests per minute per IP address for register, login and refresh.</summary>
    public int AuthPerMinute { get; set; } = 20;
}
