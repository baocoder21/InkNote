import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzInputDirective } from 'ng-zorro-antd/input';
import { NZ_MODAL_DATA, NzModalRef } from 'ng-zorro-antd/modal';

/** What the caller passes in: the dialog title and the text to start from (rename). */
export interface NameDialogData {
  title: string;
  initialName: string;
  maxLength: number;
}

/**
 * A small dialog that asks for one name. It closes with the trimmed name, or with nothing
 * when cancelled. Used to create/rename notebooks and to create tags.
 */
@Component({
  selector: 'app-name-dialog',
  imports: [FormsModule, NzButtonComponent, NzInputDirective],
  template: `
    <form (ngSubmit)="submit()">
      <input
        #nameInput
        nz-input
        name="name"
        aria-label="Name"
        autocomplete="off"
        [attr.maxlength]="data.maxLength"
        [ngModel]="name()"
        (ngModelChange)="name.set($event)"
      />
      <div class="actions">
        <button nz-button type="button" (click)="cancel()">Cancel</button>
        <button nz-button nzType="primary" type="submit" [disabled]="!canSubmit()">Save</button>
      </div>
    </form>
  `,
  styles: `
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NameDialogComponent {
  protected readonly data = inject<NameDialogData>(NZ_MODAL_DATA);
  private readonly ref = inject<NzModalRef<NameDialogComponent, string>>(NzModalRef);

  protected readonly name = signal(this.data.initialName);
  protected readonly canSubmit = computed(() => this.name().trim().length > 0);

  private readonly nameInput = viewChild.required<ElementRef<HTMLInputElement>>('nameInput');

  constructor() {
    // The dialog opens ready for typing: the box is focused and, when renaming, the old name is
    // selected so typing replaces it. The modal moves focus to its own frame right after it opens,
    // so we wait one tick and take the focus back (found with a real browser: without the wait
    // the box is never focused).
    afterNextRender(() => {
      setTimeout(() => {
        const input = this.nameInput().nativeElement;
        input.focus();
        input.select();
      });
    });
  }

  protected submit(): void {
    if (this.canSubmit()) {
      this.ref.close(this.name().trim());
    }
  }

  protected cancel(): void {
    this.ref.close();
  }
}
