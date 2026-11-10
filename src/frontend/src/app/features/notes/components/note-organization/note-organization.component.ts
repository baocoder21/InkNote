import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzOptionComponent, NzSelectComponent } from 'ng-zorro-antd/select';
import { NOTE_STATUS_OPTIONS, NoteOrganization, NoteStatus } from '../../models/note.model';
import { NotebookOption, Tag } from '../../models/organization.model';

/**
 * "Presentational" component: the pin button, the notebook picker and the tag picker of an
 * open note. It never saves anything: on every change it emits the COMPLETE new organization
 * and the parent decides what to do (the editor sends it to the store).
 */
@Component({
  selector: 'app-note-organization',
  imports: [FormsModule, NzButtonComponent, NzIconDirective, NzSelectComponent, NzOptionComponent],
  templateUrl: './note-organization.component.html',
  styleUrl: './note-organization.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteOrganizationComponent {
  readonly notebookId = input.required<string | null>();
  readonly isPinned = input.required<boolean>();
  readonly status = input.required<NoteStatus>();
  readonly tagIds = input.required<string[]>();
  readonly notebooks = input.required<NotebookOption[]>();
  readonly tags = input.required<Tag[]>();
  readonly disabled = input(false);

  protected readonly statusOptions = NOTE_STATUS_OPTIONS;

  readonly changed = output<NoteOrganization>();

  // Ids of tags that no longer exist are neither shown nor sent back (the server would answer 400).
  protected readonly shownTagIds = computed(() => {
    const known = new Set(this.tags().map((t) => t.id));
    return this.tagIds().filter((id) => known.has(id));
  });

  protected togglePin(): void {
    this.emit({ isPinned: !this.isPinned() });
  }

  protected setNotebook(id: string | null | undefined): void {
    this.emit({ notebookId: id ?? null }); // clearing the select gives null/undefined
  }

  protected setStatus(status: NoteStatus | null): void {
    this.emit({ status: status ?? 'None' });
  }

  protected setTags(ids: string[] | null): void {
    this.emit({ tagIds: ids ?? [] });
  }

  private emit(change: Partial<NoteOrganization>): void {
    this.changed.emit({
      notebookId: this.notebookId(),
      isPinned: this.isPinned(),
      status: this.status(),
      tagIds: this.shownTagIds(),
      ...change,
    });
  }
}
