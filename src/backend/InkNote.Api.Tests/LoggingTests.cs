using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using InkNote.Api.Modules.Auth.Application;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Serilog.Core;
using Serilog.Events;

namespace InkNote.Api.Tests;

/// <summary>Keeps every log event the API writes, so that a test can read what was (and was not) logged.</summary>
public sealed class CapturingSink : ILogEventSink
{
    private readonly ConcurrentQueue<LogEvent> _events = new();

    public void Emit(LogEvent logEvent) => _events.Enqueue(logEvent);

    public IReadOnlyList<LogEvent> Events => _events.ToArray();

    /// <summary>Everything one event says: its message and the value of every property, as text.</summary>
    public static string TextOf(LogEvent e) =>
        e.RenderMessage() + " " + string.Join(" ", e.Properties.Select(p => $"{p.Key}={p.Value}")) + " " + e.Exception;

    /// <summary>All the text of all events so far.</summary>
    public string Everything() => string.Join("\n", Events.Select(TextOf));

    /// <summary>The request log is written when the request ENDS, which can be a moment after the client got its answer.</summary>
    public async Task<LogEvent?> WaitForAsync(Func<LogEvent, bool> match)
    {
        for (var i = 0; i < 40; i++)
        {
            var found = Events.FirstOrDefault(match);
            if (found is not null)
            {
                return found;
            }

            await Task.Delay(50);
        }

        return null;
    }
}

public sealed class LoggingFixture : ApiFixture
{
    public CapturingSink Sink { get; } = new();

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        // Serilog adds every ILogEventSink found in DI (Program.cs: ReadFrom.Services).
        builder.ConfigureTestServices(services => services.AddSingleton<ILogEventSink>(Sink));
    }
}

/// <summary>
/// The logging rule of this project: log ids, counts and status codes; NEVER the text of a note, a token or a password.
/// These tests write secrets through the API and then look through everything that was logged.
/// </summary>
public sealed class LoggingTests(LoggingFixture api) : IClassFixture<LoggingFixture>
{
    private static bool IsRequestLog(LogEvent e, string path) =>
        e.Properties.TryGetValue("RequestPath", out var p) && p.ToString().Trim('"') == path;

    [Fact]
    public async Task Every_request_is_logged_as_one_line_with_method_path_and_status()
    {
        var client = api.CreateUserClient();

        var response = await client.GetAsync("/api/tags");
        var logged = await api.Sink.WaitForAsync(e => IsRequestLog(e, "/api/tags"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.NotNull(logged);
        Assert.Equal("GET", logged.Properties["RequestMethod"].ToString().Trim('"'));
        Assert.Equal("200", logged.Properties["StatusCode"].ToString());
        Assert.Equal(LogEventLevel.Information, logged.Level);
    }

    [Fact]
    public async Task A_token_in_the_query_string_is_never_logged()
    {
        // The SignalR connection sends the access token as ?access_token=... : only the PATH may reach the log.
        var client = api.CreateUserClient();
        var token = client.DefaultRequestHeaders.Authorization!.Parameter!;

        await client.GetAsync($"/api/notes?access_token=SECRET-QUERY-TOKEN-4711&other={token}");
        var logged = await api.Sink.WaitForAsync(e => IsRequestLog(e, "/api/notes"));

        Assert.NotNull(logged); // the request WAS logged (otherwise "not in the log" would prove nothing)
        var all = api.Sink.Everything();
        Assert.DoesNotContain("SECRET-QUERY-TOKEN-4711", all);
        Assert.DoesNotContain(token, all);
    }

    [Fact]
    public async Task The_text_of_a_note_and_a_search_for_it_are_never_logged()
    {
        var client = api.CreateUserClient();

        var created = await client.PostAsJsonAsync("/api/notes", new { title = "PRIVATE-TITLE-0815", content = "PRIVATE-BODY-0815" });
        created.EnsureSuccessStatusCode();
        var id = (await created.Content.ReadFromJsonAsync<System.Text.Json.JsonElement>()).GetProperty("id").GetGuid();
        await client.GetAsync($"/api/notes/{id}");
        await client.GetAsync("/api/notes/search?q=PRIVATE-BODY-0815");
        var logged = await api.Sink.WaitForAsync(e => IsRequestLog(e, "/api/notes/search"));

        Assert.NotNull(logged);
        Assert.DoesNotContain("PRIVATE-TITLE-0815", api.Sink.Everything());
        Assert.DoesNotContain("PRIVATE-BODY-0815", api.Sink.Everything());
    }

    [Fact]
    public async Task Passwords_and_the_tokens_that_come_back_are_never_logged()
    {
        var anonymous = api.CreateAnonymousClient();
        var email = $"log-{Guid.NewGuid():N}@example.com";

        var auth = await ApiFixture.RegisterAsync(anonymous, email, "Never-log-this-pass-99!");
        await anonymous.PostAsJsonAsync("/api/auth/login", new LoginRequest(email, "Wrong-password-on-purpose!", false));
        var logged = await api.Sink.WaitForAsync(e => IsRequestLog(e, "/api/auth/login"));

        Assert.NotNull(logged);
        var all = api.Sink.Everything();
        Assert.DoesNotContain("Never-log-this-pass-99!", all);
        Assert.DoesNotContain("Wrong-password-on-purpose!", all);
        Assert.DoesNotContain(auth.AccessToken, all);
    }

    [Fact]
    public async Task A_refused_request_is_a_warning_and_the_health_check_is_not_logged_at_all()
    {
        var client = api.CreateAnonymousClient();

        var unauthorized = await client.GetAsync("/api/notebooks");
        await client.GetAsync("/api/health");
        var refused = await api.Sink.WaitForAsync(e => IsRequestLog(e, "/api/notebooks") && e.Properties["StatusCode"].ToString() == "401");
        await Task.Delay(300); // time for a (wrong) health log to show up

        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        Assert.NotNull(refused);
        Assert.Equal(LogEventLevel.Warning, refused.Level);
        Assert.DoesNotContain(api.Sink.Events, e => IsRequestLog(e, "/api/health"));
    }
}
