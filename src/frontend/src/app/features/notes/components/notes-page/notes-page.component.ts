import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { NzButtonComponent } from 'ng-zorro-antd/button';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { NzMessageService } from 'ng-zorro-antd/message';
import { NotesStore } from '../../store/notes.store';
import { NotesListComponent } from '../notes-list/notes-list.component';

/**
 * "Container" component: owns the layout and talks to the store.
 * The list and the editor are separate components that show the data.
 */
@Component({
  selector: 'app-notes-page',
  imports: [RouterOutlet, NzButtonComponent, NzIconDirective, NotesListComponent],
  templateUrl: './notes-page.component.html',
  styleUrl: './notes-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesPageComponent implements OnInit {
  protected readonly store = inject(NotesStore);
  private readonly router = inject(Router);
  private readonly message = inject(NzMessageService);

  ngOnInit(): void {
    void this.loadList();
  }

  private async loadList(): Promise<void> {
    const ok = await this.store.loadNotes();
    if (!ok) {
      this.message.error('Cannot load notes. Is the backend running on port 5032?');
    }
  }

  protected async createNote(): Promise<void> {
    const note = await this.store.createNote();
    if (note) {
      await this.router.navigate(['/notes', note.id]);
    } else {
      this.message.error('Cannot create the note');
    }
  }
}
