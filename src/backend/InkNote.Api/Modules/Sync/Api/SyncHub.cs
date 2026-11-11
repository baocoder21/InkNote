using System.Security.Claims;
using InkNote.Api.Common;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.SignalR;

namespace InkNote.Api.Modules.Sync.Api;

/// <summary>
/// The "doorbell": a device connects here (a WebSocket, or a fallback that SignalR picks) and is put in a group
/// of its own user, so a notification reaches that user's devices and nobody else's. Clients call nothing;
/// the server only sends <see cref="Application.SyncNotifier.ChangedMessage"/>.
/// </summary>
[Authorize]
public sealed class SyncHub : Hub
{
    public const string Path = "/hubs/sync";

    public static string GroupFor(Guid userId) => $"user:{userId}";

    public override async Task OnConnectedAsync()
    {
        // The user id comes from the validated token, never from anything the client says. Groups forget a
        // connection by themselves when it closes.
        var subject = Context.User?.FindFirstValue(HttpCurrentUser.SubjectClaim);
        if (!Guid.TryParse(subject, out var userId))
        {
            Context.Abort();
            return;
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GroupFor(userId));
        await base.OnConnectedAsync();
    }
}
