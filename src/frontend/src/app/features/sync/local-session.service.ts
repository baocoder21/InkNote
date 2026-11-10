import { Injectable, inject } from '@angular/core';
import { LocalDbService } from './local/local-db';
import { SyncEngine } from './sync-engine.service';

/**
 * The life of the local data of the signed-in user on this device: open the database (named after the user)
 * and start synchronizing when the notes page appears; stop when the user goes; and on sign-out delete
 * everything, so nothing of this user stays on a computer that someone else may use next.
 *
 * (When a session merely EXPIRES the data is kept: the same user signs in again and the changes that were
 * still waiting are sent. Only an explicit sign-out wipes.)
 */
@Injectable({ providedIn: 'root' })
export class LocalSession {
  private readonly local = inject(LocalDbService);
  private readonly engine = inject(SyncEngine);

  /** Opens this user's database and starts the synchronization. Safe to call again. */
  async begin(userId: string): Promise<void> {
    if (this.local.openUserId() === userId) {
      return;
    }
    await this.local.open(userId);
    this.engine.start();
  }

  /** Stops synchronizing and closes the database, keeping the data on disk. */
  end(): void {
    this.engine.stop();
    this.local.close();
  }

  /** Stops, then deletes this user's data from this device. */
  async wipe(): Promise<void> {
    this.engine.stop();
    await this.local.wipe();
  }
}
