namespace InkNote.Api.Modules.Sync.Contracts;

/// <summary>
/// "Something changed for this user: tell their devices." The notification carries NO data: a device that gets it
/// simply runs the normal pull. So a lost notification costs nothing (the next pull catches up), and there is
/// still only one way for data to reach a device.
/// </summary>
public interface ISyncNotifier
{
    /// <summary>
    /// Returns at once. The devices are told a little later (once the change can be pulled, see
    /// <c>SyncOptions.SettleWindow</c>), and a burst of changes becomes ONE notification.
    /// </summary>
    void NotifyChanged(Guid userId);
}
