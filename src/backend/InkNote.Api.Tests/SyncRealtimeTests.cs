using System.Diagnostics;
using System.Net;
using System.Net.Http.Json;
using System.Threading.Channels;
using InkNote.Api.Modules.Notes.Application;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace InkNote.Api.Tests;

/// <summary>One device's connection to the hub, collecting the "changed" notifications it receives.</summary>
public sealed class Device : IAsyncDisposable
{
    private readonly Channel<long> received = Channel.CreateUnbounded<long>();
    private int count;

    public HubConnection Connection { get; }
    public int Count => Volatile.Read(ref count);

    public Device(ApiFixture api, string? token, bool tokenInQueryString = false)
    {
        var url = new Uri(api.Server.BaseAddress, tokenInQueryString ? $"/hubs/sync?access_token={token}" : "/hubs/sync");
        Connection = new HubConnectionBuilder()
            .WithUrl(url, options =>
            {
                options.HttpMessageHandlerFactory = _ => api.Server.CreateHandler(); // the in-memory server
                options.Transports = HttpTransportType.LongPolling;                    // TestServer has no real sockets
                if (!tokenInQueryString)
                {
                    options.AccessTokenProvider = () => Task.FromResult(token);
                }
            })
            .Build();
        Connection.On(SyncNotifierNames.Changed, () =>
        {
            Interlocked.Increment(ref count);
            received.Writer.TryWrite(Stopwatch.GetTimestamp());
        });
    }

    public async Task StartAsync()
    {
        await Connection.StartAsync();
        await Task.Delay(150); // the server puts the connection in its group just after the handshake
    }

    /// <summary>Waits for the next notification; false when none comes in time.</summary>
    public async Task<bool> NextAsync(TimeSpan timeout)
    {
        using var cts = new CancellationTokenSource(timeout);
        try
        {
            await received.Reader.ReadAsync(cts.Token);
            return true;
        }
        catch (OperationCanceledException)
        {
            return false;
        }
    }

    public ValueTask DisposeAsync() => Connection.DisposeAsync();
}

/// <summary>The message name, spelled once here so a typo in the server cannot hide behind a typo in the test.</summary>
internal static class SyncNotifierNames
{
    public const string Changed = InkNote.Api.Modules.Sync.Application.SyncNotifier.ChangedMessage;
}

/// <summary>Real-time: the hub tells a user's devices that something changed.</summary>
public sealed class SyncRealtimeTests(ApiFixture api) : SyncTestBase(api), IClassFixture<ApiFixture>
{
    private static readonly TimeSpan Soon = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan Quiet = TimeSpan.FromMilliseconds(700);

    private string Token => Client.DefaultRequestHeaders.Authorization!.Parameter!;

    private async Task<Device> ConnectAsync(string? token = null, bool inQueryString = false)
    {
        var device = new Device(Api, token ?? Token, inQueryString);
        await device.StartAsync();
        return device;
    }

    [Fact]
    public async Task The_hub_requires_sign_in()
    {
        var negotiate = await Api.CreateAnonymousClient().PostAsync("/hubs/sync/negotiate?negotiateVersion=1", null);
        Assert.Equal(HttpStatusCode.Unauthorized, negotiate.StatusCode);

        await using var device = new Device(Api, token: null);
        var failure = await Assert.ThrowsAsync<HttpRequestException>(() => device.Connection.StartAsync());
        Assert.Equal(HttpStatusCode.Unauthorized, failure.StatusCode);
    }

    [Fact]
    public async Task A_garbage_token_is_refused()
    {
        await using var device = new Device(Api, token: "not-a-token");

        var failure = await Assert.ThrowsAsync<HttpRequestException>(() => device.Connection.StartAsync());

        Assert.Equal(HttpStatusCode.Unauthorized, failure.StatusCode);
    }

    [Fact]
    public async Task A_device_is_told_when_the_user_pushes_a_change()
    {
        await using var device = await ConnectAsync();

        await PushOneAsync(Upsert("note", Guid.NewGuid(), new { title = "From a phone", content = "x" }));

        Assert.True(await device.NextAsync(Soon));
    }

    [Fact]
    public async Task The_token_may_travel_in_the_query_string_because_a_browser_WebSocket_cannot_send_headers()
    {
        await using var device = await ConnectAsync(inQueryString: true);

        await RestCreateNoteAsync("Query string");

        Assert.True(await device.NextAsync(Soon));
    }

    [Fact]
    public async Task The_query_string_token_is_accepted_only_for_hubs_never_for_the_REST_API()
    {
        var anonymous = Api.CreateAnonymousClient();

        var response = await anonymous.GetAsync($"/api/sync/pull?access_token={Token}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Every_device_of_the_user_is_told_and_nobody_else()
    {
        var other = Api.CreateUserClient(out var otherAuth);
        await using var first = await ConnectAsync();
        await using var second = await ConnectAsync();
        await using var stranger = await ConnectAsync(otherAuth.AccessToken);

        await RestCreateNoteAsync("Mine");

        Assert.True(await first.NextAsync(Soon));
        Assert.True(await second.NextAsync(Soon));
        Assert.False(await stranger.NextAsync(Quiet)); // another user's devices hear nothing of it
        Assert.Equal(0, stranger.Count);
        GC.KeepAlive(other);
    }

    [Fact]
    public async Task A_change_of_another_user_does_not_reach_this_user()
    {
        var other = Api.CreateUserClient();
        await using var mine = await ConnectAsync();

        var response = await other.PostAsJsonAsync("/api/notes", new CreateNoteRequest("Not yours", "x"));
        response.EnsureSuccessStatusCode();

        Assert.False(await mine.NextAsync(Quiet));
    }

    [Fact]
    public async Task Whichever_way_data_is_saved_the_devices_are_told()
    {
        await using var device = await ConnectAsync();

        // 1. a note through the REST API
        var note = await RestCreateNoteAsync("Rest");
        Assert.True(await device.NextAsync(Soon), "note created");

        // 2. a tag
        (await Client.PostAsJsonAsync("/api/tags", new { name = "tag-" + Guid.NewGuid().ToString("N")[..6] })).EnsureSuccessStatusCode();
        Assert.True(await device.NextAsync(Soon), "tag created");

        // 3. a notebook
        (await Client.PostAsJsonAsync("/api/notebooks", new { name = "Book " + Guid.NewGuid().ToString("N")[..6] })).EnsureSuccessStatusCode();
        Assert.True(await device.NextAsync(Soon), "notebook created");

        // 4. moving a note to the trash, then restoring it (the restore is not a sync operation)
        (await Client.DeleteAsync($"/api/notes/{note.Id}")).EnsureSuccessStatusCode();
        Assert.True(await device.NextAsync(Soon), "note deleted");
        (await Client.PostAsync($"/api/notes/trash/{note.Id}/restore", null)).EnsureSuccessStatusCode();
        Assert.True(await device.NextAsync(Soon), "note restored");
    }

    [Fact]
    public async Task Reading_changes_nothing_so_nobody_is_told()
    {
        await RestCreateNoteAsync("Seed");
        await using var device = await ConnectAsync();
        await device.NextAsync(Quiet); // the creation above may still be on its way

        await PullAsync();
        (await Client.GetAsync("/api/notes")).EnsureSuccessStatusCode();

        Assert.False(await device.NextAsync(Quiet));
    }

    [Fact]
    public async Task A_change_that_is_rejected_tells_nobody()
    {
        await using var device = await ConnectAsync();

        // A notebook that still contains another one cannot be deleted: the server refuses, nothing is saved.
        var parent = Guid.NewGuid();
        var child = Guid.NewGuid();
        await PushAsync(
            Upsert("notebook", parent, new { name = "Parent", parentId = (Guid?)null }),
            Upsert("notebook", child, new { name = "Child", parentId = parent }));
        Assert.True(await device.NextAsync(Soon));
        await device.NextAsync(Quiet); // drain: the two operations may have made two notifications

        var result = await PushOneAsync(Delete("notebook", parent));

        Assert.Equal("rejected", result.Status);
        Assert.False(await device.NextAsync(Quiet));
    }

    [Fact]
    public async Task A_closed_connection_is_simply_forgotten_and_the_server_carries_on()
    {
        var device = await ConnectAsync();
        await device.DisposeAsync();

        await RestCreateNoteAsync("Nobody is listening");
        await using var later = await ConnectAsync();
        await RestCreateNoteAsync("Somebody is");

        Assert.True(await later.NextAsync(Soon));
    }
}

/// <summary>
/// With the settle window on (2 s) the notification must not come BEFORE the change can be pulled: a device that
/// pulled at once would be given nothing and nothing would send it again.
/// </summary>
public sealed class SyncRealtimeSettleWindowTests(SettleWindowFixture api) : SyncTestBase(api), IClassFixture<SettleWindowFixture>
{
    private string Token => Client.DefaultRequestHeaders.Authorization!.Parameter!;

    [Fact]
    public async Task The_notification_comes_when_the_change_can_be_pulled_not_before()
    {
        await using var device = new Device(Api, Token);
        await device.StartAsync();
        var id = Guid.NewGuid();

        var clock = Stopwatch.StartNew();
        await PushOneAsync(Upsert("note", id, new { title = "Settling", content = "x" }));
        Assert.True(await device.NextAsync(TimeSpan.FromSeconds(8)));
        var waited = clock.Elapsed;

        var page = await PullAsync();

        Assert.True(waited >= TimeSpan.FromSeconds(1.8), $"told after only {waited.TotalSeconds:0.0} s"); // the window is 2 s
        Assert.Contains(page.Changes, c => c.Id == id); // and the pull it caused really finds the change
    }

    [Fact]
    public async Task A_burst_of_changes_is_one_notification_and_one_pull_finds_them_all()
    {
        await using var device = new Device(Api, Token);
        await device.StartAsync();

        var ids = new List<Guid>();
        for (var i = 0; i < 8; i++)
        {
            ids.Add((await RestCreateNoteAsync($"Burst {i}")).Id);
        }

        Assert.True(await device.NextAsync(TimeSpan.FromSeconds(8)));
        Assert.False(await device.NextAsync(TimeSpan.FromSeconds(1))); // not eight
        var page = await PullAsync();

        Assert.True(ids.All(id => page.Changes.Any(c => c.Id == id)));
    }
}
