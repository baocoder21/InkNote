import { Injectable, inject } from '@angular/core';
import { LocalDbService, LocalNote, LocalNotebook, LocalTag } from '../sync/local/local-db';

export interface ExportRow extends LocalNote {
  content: string;
}

/**
 * Reads everything of the user from THIS device, for the export. A read only: the import writes through the
 * ordinary repositories, so that everything it makes is queued for the server like anything else.
 */
@Injectable({ providedIn: 'root' })
export class TransferRepository {
  private readonly local = inject(LocalDbService);

  async notes(): Promise<ExportRow[]> {
    const db = this.local.db;
    return db.transaction('r', db.notes, db.contents, async () => {
      const rows = await db.notes.toArray();
      const contents = new Map((await db.contents.toArray()).map((c) => [c.id, c.content]));
      return rows.map((row) => ({ ...row, content: contents.get(row.id) ?? '' }));
    });
  }

  notebooks(): Promise<LocalNotebook[]> {
    return this.local.db.notebooks.toArray();
  }

  tags(): Promise<LocalTag[]> {
    return this.local.db.tags.toArray();
  }

  async note(id: string): Promise<ExportRow | null> {
    const db = this.local.db;
    return db.transaction('r', db.notes, db.contents, async () => {
      const row = await db.notes.get(id);
      return row ? { ...row, content: (await db.contents.get(id))?.content ?? '' } : null;
    });
  }
}
