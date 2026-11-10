import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { SyncState } from '../../sync-engine.service';

/**
 * "Presentational" component: the small line at the bottom of the sidebar that says where the data stands:
 * all synchronized, changes waiting, syncing, offline, or a problem. Pressing it asks for a new attempt.
 */
@Component({
  selector: 'app-sync-status',
  imports: [NzIconDirective, DatePipe],
  templateUrl: './sync-status.component.html',
  styleUrl: './sync-status.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SyncStatusComponent {
  readonly state = input.required<SyncState>();
  readonly pending = input(0);
  readonly lastSyncedAt = input<Date | null>(null);

  /** The user pressed it: try to synchronize now. */
  readonly retry = output<void>();

  protected readonly waiting = computed(() => {
    const count = this.pending();
    return count === 1 ? '1 change waiting' : `${count} changes waiting`;
  });

  protected readonly label = computed(() => {
    const waiting = this.pending() > 0;
    switch (this.state()) {
      case 'syncing':
        return 'Syncing...';
      case 'offline':
        return waiting ? `Offline · ${this.waiting()}` : 'Offline';
      case 'error':
        return waiting ? `Sync problem · ${this.waiting()}` : 'Sync problem';
      default:
        return waiting ? this.waiting() : 'All changes synced';
    }
  });

  protected readonly icon = computed(() => {
    switch (this.state()) {
      case 'syncing':
        return 'sync';
      case 'offline':
        return 'disconnect';
      case 'error':
        return 'exclamation-circle';
      default:
        return this.pending() > 0 ? 'sync' : 'check';
    }
  });
}
