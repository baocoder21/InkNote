using FluentValidation;
using InkNote.Api.Common;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Modules.Auth.Domain;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Authorization;
using Microsoft.Extensions.Options;
using Microsoft.IdentityModel.Tokens;

namespace InkNote.Api.Modules.Auth;

public static class AuthModule
{
    /// <summary>Registers sign-in (Identity), token checking (JWT) and "sign-in required" as the default.</summary>
    public static IServiceCollection AddAuthModule(this IServiceCollection services)
    {
        // Settings are bound lazily (when first needed), like the connection string: in tests the
        // test configuration is added after Program.cs has started building.
        services.AddOptions<JwtOptions>()
            .BindConfiguration(JwtOptions.SectionName)
            .Validate(o => o.Validate() is null, "Invalid 'Jwt' settings (missing or too short 'Jwt:Key').")
            .ValidateOnStart();
        services.AddOptions<AuthRateLimitOptions>().BindConfiguration(AuthRateLimitOptions.SectionName);

        // AddIdentityCore = users, password hashing, lockout. NOT the cookie sign-in of full Identity:
        // our sessions are JWTs. Only the pieces we use are registered.
        services.AddIdentityCore<AppUser>(options =>
            {
                options.User.RequireUniqueEmail = true;

                // Length protects better than "must contain a symbol", so only the length is required.
                options.Password.RequiredLength = 8;
                options.Password.RequireDigit = false;
                options.Password.RequireLowercase = false;
                options.Password.RequireUppercase = false;
                options.Password.RequireNonAlphanumeric = false;

                // 5 wrong passwords lock the account for 15 minutes (slows down password guessing).
                options.Lockout.AllowedForNewUsers = true;
                options.Lockout.MaxFailedAccessAttempts = 5;
                options.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(15);
            })
            .AddEntityFrameworkStores<AppDbContext>();

        services.AddHttpContextAccessor();
        services.AddScoped<ICurrentUser, HttpCurrentUser>();
        services.AddScoped<ILegacyDataAdopter, LegacyDataAdopter>();
        services.AddScoped<TokenService>();
        services.AddScoped<AuthService>();
        services.AddValidatorsFromAssemblyContaining<RegisterRequestValidator>();

        // How the API checks the "Authorization: Bearer <token>" header of every request.
        services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme).AddJwtBearer();
        services.AddSingleton<IConfigureOptions<JwtBearerOptions>, ConfigureJwtBearer>();

        // The default for every endpoint is "must be signed in". Endpoints that must stay open
        // (health, register, login...) say so explicitly with AllowAnonymous(): forgetting to
        // protect a new endpoint is then impossible, forgetting to OPEN one is merely visible.
        services.AddAuthorizationBuilder()
            .SetFallbackPolicy(new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build());

        return services;
    }
}

/// <summary>Tells the JWT middleware how to validate tokens, using the settings above.</summary>
internal sealed class ConfigureJwtBearer(IOptions<JwtOptions> options) : IConfigureNamedOptions<JwtBearerOptions>
{
    public void Configure(string? name, JwtBearerOptions bearer)
    {
        if (name != JwtBearerDefaults.AuthenticationScheme)
        {
            return;
        }

        var jwt = options.Value;
        bearer.MapInboundClaims = false; // keep claim names as they are in the token ("sub", "email")
        bearer.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuer = true,
            ValidIssuer = jwt.Issuer,
            ValidateAudience = true,
            ValidAudience = jwt.Audience,
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(jwt.KeyBytes),
            ValidateLifetime = true,
            ClockSkew = jwt.ClockSkew,
            // Only the algorithm we sign with: a token claiming "alg: none" or another algorithm is refused.
            ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
            NameClaimType = HttpCurrentUser.SubjectClaim,
        };
    }

    public void Configure(JwtBearerOptions bearer) => Configure(JwtBearerDefaults.AuthenticationScheme, bearer);
}
