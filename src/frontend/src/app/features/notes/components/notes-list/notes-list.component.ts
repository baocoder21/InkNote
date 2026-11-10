import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { NoteSummary } from '../../models/note.model';

/**
 * "Presentational" component: it only shows what it receives through inputs.
 * It knows nothing about the store or the API, which makes it easy to reuse and test.
 */
@Component({
  selector: 'app-notes-list',
  imports: [RouterLink, RouterLinkActive, DatePipe, NzSpinComponent],
  templateUrl: './notes-list.component.html',
  styleUrl: './notes-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotesListComponent {
  readonly notes = input.required<NoteSummary[]>();
  readonly loading = input(false);
}
