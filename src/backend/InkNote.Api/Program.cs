using System.Threading.RateLimiting;
using InkNote.Api.Modules.Auth;
using InkNote.Api.Modules.Auth.Api;
using InkNote.Api.Modules.Auth.Application;
using InkNote.Api.Modules.Notebooks;
using InkNote.Api.Modules.Notebooks.Api;
using InkNote.Api.Modules.Notes;
using InkNote.Api.Modules.Notes.Api;
using InkNote.Api.Modules.Sync;
using InkNote.Api.Modules.Sync.Api;
using InkNote.Api.Modules.Tags;
using InkNote.Api.Modules.Tags.Api;
using InkNote.Api.Persistence;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

var builder = WebApplication.CreateBuilder(args);

// Register services in the dependency-injection (DI) container.
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails(); // errors are returned as standard ProblemDetails JSON
builder.Services.AddExceptionHandler<InkNote.Api.Http.BadRequestExceptionHandler>(); // unreadable body -> 400, not 500
builder.Services.AddSingleton(TimeProvider.System); // injectable clock (easy to fake in tests)

// The connection string is read lazily (when the DbContext is first created) from
// configuration key "ConnectionStrings:Default". In development it comes from user-secrets.
builder.Services.AddDbContext<AppDbContext>((serviceProvider, options) =>
{
    var connectionString = serviceProvider.GetRequiredService<IConfiguration>()
        .GetConnectionString("Default")
        ?? throw new InvalidOperationException(
            "Missing connection string 'ConnectionStrings:Default'. " +
            "See docs/LEARNING.md (Phase 1) to set it with user-secrets.");

    options.UseNpgsql(connectionString).UseSnakeCaseNamingConvention();
});

builder.Services.AddAuthModule(); // accounts, JWT, "sign in required" by default
builder.Services.AddNotesModule();
builder.Services.AddNotebooksModule();
builder.Services.AddTagsModule();
builder.Services.AddSyncModule(); // push/pull of changes for the devices

// CORS: the browser blocks the Angular dev server (another origin) from calling
// this API unless the API explicitly allows that origin.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        // The refresh token travels in a cookie: the browser only sends cookies on cross-origin
        // requests when the server allows credentials (and then origins must be listed, never "*").
        .AllowCredentials());
});

// Rate limiting: at most N register/login/refresh requests per minute per IP address. The limit is
// read from configuration when the first request arrives (tests raise it).
builder.Services.AddRateLimiter(_ => { });
builder.Services.AddOptions<RateLimiterOptions>().Configure<IOptions<AuthRateLimitOptions>>((limiter, settings) =>
{
    limiter.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    limiter.AddPolicy(AuthEndpoints.RateLimitPolicy, http => RateLimitPartition.GetFixedWindowLimiter(
        http.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions
        {
            PermitLimit = settings.Value.AuthPerMinute,
            Window = TimeSpan.FromMinutes(1),
            QueueLimit = 0, // over the limit = rejected at once, not queued
        }));
});

var app = builder.Build();

// Configure the HTTP request pipeline (order matters).
app.UseExceptionHandler();   // unhandled exceptions -> 500 ProblemDetails
app.UseStatusCodePages();    // bare 404/405... -> ProblemDetails body

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi().AllowAnonymous();   // OpenAPI document (built into .NET 9): /openapi/v1.json
    app.UseSwaggerUI(options =>   // interactive API docs UI: /swagger
    {
        options.SwaggerEndpoint("/openapi/v1.json", "InkNote API v1");
    });
}

app.UseCors();
app.UseRateLimiter();
app.UseAuthentication(); // reads the Bearer token and fills HttpContext.User
app.UseAuthorization();  // applies the policies (the default: signed in)

// Minimal API endpoint: used to verify that frontend and backend are connected.
app.MapGet("/api/health", () => Results.Ok(new
{
    status = "OK",
    service = "InkNote.Api",
    time = DateTimeOffset.UtcNow
}))
.WithName("GetHealth")
.AllowAnonymous(); // the front end and monitors call it without signing in

app.MapAuthEndpoints();
app.MapNotesEndpoints();
app.MapNotebooksEndpoints();
app.MapTagsEndpoints();
app.MapSyncEndpoints();

app.Run();

// Makes the auto-generated Program class visible to the test project (WebApplicationFactory).
public partial class Program;
