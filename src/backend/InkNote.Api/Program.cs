var builder = WebApplication.CreateBuilder(args);

// Register services in the dependency-injection (DI) container.
builder.Services.AddOpenApi();

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
if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
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

app.Run();
