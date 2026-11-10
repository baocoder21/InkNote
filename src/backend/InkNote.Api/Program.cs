using InkNote.Api.Modules.Notes;
using InkNote.Api.Modules.Notes.Api;
using InkNote.Api.Persistence;
using Microsoft.EntityFrameworkCore;

var builder = WebApplication.CreateBuilder(args);

// Register services in the dependency-injection (DI) container.
builder.Services.AddOpenApi();
builder.Services.AddProblemDetails(); // errors are returned as standard ProblemDetails JSON
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

builder.Services.AddNotesModule();

// CORS: the browser blocks the Angular dev server (another origin) from calling
// this API unless the API explicitly allows that origin.
var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod());
});

var app = builder.Build();

// Configure the HTTP request pipeline (order matters).
app.UseExceptionHandler();   // unhandled exceptions -> 500 ProblemDetails
app.UseStatusCodePages();    // bare 404/405... -> ProblemDetails body

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();   // OpenAPI document (built into .NET 9): /openapi/v1.json
    app.UseSwaggerUI(options =>   // interactive API docs UI: /swagger
    {
        options.SwaggerEndpoint("/openapi/v1.json", "InkNote API v1");
    });
}

app.UseCors();

// Minimal API endpoint: used to verify that frontend and backend are connected.
app.MapGet("/api/health", () => Results.Ok(new
{
    status = "OK",
    service = "InkNote.Api",
    time = DateTimeOffset.UtcNow
}))
.WithName("GetHealth");

app.MapNotesEndpoints();

app.Run();

// Makes the auto-generated Program class visible to the test project (WebApplicationFactory).
public partial class Program;
