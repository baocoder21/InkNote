import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NzModalService } from 'ng-zorro-antd/modal';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { NoteSummary } from '../../models/note.model';
import { SyncEngine } from '../../../sync/sync-engine.service';
import { TrashStore } from '../../store/trash.store';
import { MarkdownPreviewComponent } from '../markdown-preview/markdown-preview.component';

/**
 * The trash (route /notes/trash), shown in the right-hand pane: the deleted notes on the left,
 * a read-only preview of the chosen one on the right. From here a note can be restored, or
 * deleted for good (one by one, or all at once). Only "for good" asks for confirmation:
 * restoring is harmless and easy to undo (delete the note again).
 */
@Component({
  selector: 'app-trash-page',
  imports: [DatePipe, NzButtonComponent, NzIconDirective, NzSpinComponent, MarkdownPreviewComponent],
  templateUrl: './trash-page.component.html',
  styleUrl: './trash-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrashPageComponent implements OnInit {
  protected readonly trash = inject(TrashStore);
  private readonly engine = inject(SyncEngine);
  private readonly modal = inject(NzModalService);
  private readonly message = inject(NzMessageService);

  ngOnInit(): void {
    // Opening the page starts from a fresh list and nothing selected.
    this.trash.clearSelection();
    void this.trash.load();
  }

  protected async open(note: NoteSummary): Promise<void> {
    if ((await this.trash.select(note.id)) === 'not-found') {
      this.message.warning('This note is no longer in the trash');
      void this.trash.load();
    }
  }

  protected async restore(event: Event, note: NoteSummary): Promise<void> {
    event.stopPropagation(); // the button is inside the clickable row
    const result = await this.trash.restore(note.id);
    if (result === 'ok') {
      // The restored note exists on the server only. A synchronization brings it back to this device, and the
      // sidebar (which reads this device) then shows it. Not awaited: the user need not wait for the network.
      void this.engine.syncNow();
      this.message.success(`Restored "${note.title}"`, { nzDuration: 2000 });
    } else if (result === 'not-found') {
      this.message.warning('This note is no longer in the trash');
    } else {
      this.message.error('Cannot restore the note');
    }
  }

  protected confirmPurge(event: Event, note: NoteSummary): void {
    event.stopPropagation();
    this.modal.confirm({
      nzTitle: 'Delete forever',
      nzContent: `Delete "${note.title}" forever? This cannot be undone.`,
      nzOkText: 'Delete forever',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.purge(note),
    });
  }

  private async purge(note: NoteSummary): Promise<void> {
    const result = await this.trash.purge(note.id);
    if (result === 'error') {
      this.message.error('Cannot delete the note');
    } else {
      this.message.success('Deleted forever', { nzDuration: 1500 });
    }
  }

  protected confirmEmpty(): void {
    const count = this.trash.items().length;
    this.modal.confirm({
      nzTitle: 'Empty trash',
      nzContent: `Delete ${count} ${count === 1 ? 'note' : 'notes'} forever? This cannot be undone.`,
      nzOkText: 'Empty trash',
      nzOkDanger: true,
      nzCancelText: 'Cancel',
      nzOnOk: () => this.empty(),
    });
  }

  private async empty(): Promise<void> {
    const deleted = await this.trash.empty();
    if (deleted === null) {
      this.message.error('Cannot empty the trash');
    } else {
      this.message.success('Trash emptied', { nzDuration: 1500 });
    }
  }
}
