using System.Runtime.CompilerServices;
using InkNote.Api.Modules.Notebooks.Domain;
using InkNote.Api.Modules.Notes.Domain;
using InkNote.Api.Modules.Sync.Contracts;
using InkNote.Api.Modules.Tags.Domain;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;

namespace InkNote.Api.Persistence;

/// <summary>
/// Tells the owner's devices whenever a note, notebook or tag of theirs was saved, WHICHEVER code saved it
/// (synchronization, the REST endpoints, restoring from the trash). Nobody has to remember to notify, just as the
/// database triggers of Phase 7 mean nobody has to remember to stamp a change.
/// The owners are collected BEFORE the save (afterwards the tracker no longer says what was added/deleted)
/// and announced only AFTER it succeeded.
/// </summary>
public sealed class SyncNotificationInterceptor(ISyncNotifier notifier) : SaveChangesInterceptor
{
    // One context saves one at a time, but the interceptor is shared by all contexts: keep the owners per context.
    private readonly ConditionalWeakTable<DbContext, HashSet<Guid>> owners = new();

    public override InterceptionResult<int> SavingChanges(DbContextEventData eventData, InterceptionResult<int> result)
    {
        Collect(eventData.Context);
        return result;
    }

    public override ValueTask<InterceptionResult<int>> SavingChangesAsync(
        DbContextEventData eventData, InterceptionResult<int> result, CancellationToken cancellationToken = default)
    {
        Collect(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override int SavedChanges(SaveChangesCompletedEventData eventData, int result)
    {
        Announce(eventData.Context);
        return result;
    }

    public override ValueTask<int> SavedChangesAsync(
        SaveChangesCompletedEventData eventData, int result, CancellationToken cancellationToken = default)
    {
        Announce(eventData.Context);
        return ValueTask.FromResult(result);
    }

    public override void SaveChangesFailed(DbContextErrorEventData eventData) => Forget(eventData.Context);

    public override Task SaveChangesFailedAsync(DbContextErrorEventData eventData, CancellationToken cancellationToken = default)
    {
        Forget(eventData.Context);
        return Task.CompletedTask;
    }

    private void Collect(DbContext? context)
    {
        if (context is null)
        {
            return;
        }

        var found = new HashSet<Guid>();
        foreach (var entry in context.ChangeTracker.Entries())
        {
            if (entry.State is not (EntityState.Added or EntityState.Modified or EntityState.Deleted)
                || entry.Entity is not (Note or Notebook or Tag))
            {
                continue;
            }

            if (entry.Property("UserId").CurrentValue is Guid owner)
            {
                found.Add(owner);
            }
        }

        if (found.Count > 0)
        {
            owners.AddOrUpdate(context, found);
        }
    }

    private void Announce(DbContext? context)
    {
        if (context is not null && owners.TryGetValue(context, out var found))
        {
            owners.Remove(context);
            foreach (var owner in found)
            {
                notifier.NotifyChanged(owner);
            }
        }
    }

    private void Forget(DbContext? context)
    {
        if (context is not null)
        {
            owners.Remove(context);
        }
    }
}
