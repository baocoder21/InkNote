using System.Collections.Concurrent;
using System.Diagnostics;
using InkNote.Api.Modules.Sync.Api;
using InkNote.Api.Modules.Sync.Contracts;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace InkNote.Api.Modules.Sync.Application;

/// <summary>
/// Tells the devices of a user that something changed, but only once the change is old enough to be pulled
/// (a pull hands out nothing younger than the settle window, so telling them sooner would send them for nothing,
/// and nothing would send them again). A burst of changes is one notification, sent after things went quiet.
/// </summary>
public sealed class SyncNotifier(
    IHubContext<SyncHub> hub,
    IOptions<SyncOptions> options,
    ILogger<SyncNotifier> logger) : ISyncNotifier
{
    /// <summary>The name of the (data-less) message the devices receive.</summary>
    public const string ChangedMessage = "changed";

    /// <summary>However busy the user is, the devices are told at least this often.</summary>
    private static readonly TimeSpan MaxWait = TimeSpan.FromSeconds(10);

    private sealed class Pending
    {
        public long FirstChange;   // since when the devices have not been told
        public long LastChange;
        public bool Running;       // a task is waiting to send
        public bool Done;          // the task has finished and this object was removed: take a new one
    }

    private readonly ConcurrentDictionary<Guid, Pending> pending = new();

    public void NotifyChanged(Guid userId)
    {
        var now = Stopwatch.GetTimestamp();
        while (true)
        {
            var state = pending.GetOrAdd(userId, _ => new Pending());
            lock (state)
            {
                if (state.Done)
                {
                    continue; // lost a race with the end of the previous task: use the new object
                }

                if (!state.Running)
                {
                    state.Running = true;
                    state.FirstChange = now;
                    _ = Task.Run(() => RunAsync(userId, state));
                }

                state.LastChange = now;
                return;
            }
        }
    }

    private async Task RunAsync(Guid userId, Pending state)
    {
        var quiet = options.Value.SettleWindow + options.Value.NotifyMargin;
        while (true)
        {
            long last, first;
            lock (state)
            {
                last = state.LastChange;
                first = state.FirstChange;
            }

            var now = Stopwatch.GetTimestamp();
            var wait = quiet - Stopwatch.GetElapsedTime(last, now);
            var mayWait = MaxWait - Stopwatch.GetElapsedTime(first, now);
            if (wait > TimeSpan.Zero && mayWait > TimeSpan.Zero)
            {
                await Task.Delay(wait < mayWait ? wait : mayWait);
                continue; // changes may have come in meanwhile: look again
            }

            try
            {
                await hub.Clients.Group(SyncHub.GroupFor(userId)).SendAsync(ChangedMessage);
            }
            catch (Exception ex)
            {
                // Never fatal: the devices still pull on their own timer.
                logger.LogWarning(ex, "Could not notify the devices of a user.");
            }

            lock (state)
            {
                if (state.LastChange == last)
                {
                    state.Done = true;
                    state.Running = false;
                    pending.TryRemove(userId, out _);
                    return;
                }

                state.FirstChange = state.LastChange; // more changes arrived while sending: another round
            }
        }
    }
}
