import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NzIconDirective } from 'ng-zorro-antd/icon';

/** Shown on the right-hand side when no note is selected. */
@Component({
  selector: 'app-note-empty',
  imports: [NzIconDirective],
  template: `
    <div class="empty">
      <nz-icon nzType="file-text" nzTheme="outline" />
      <p>Select a note on the left, or create a new one.</p>
    </div>
  `,
  styles: `
    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.75rem;
      height: 100%;
      color: var(--ink-text-muted);

      nz-icon {
        font-size: 2.5rem;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteEmptyComponent {}
