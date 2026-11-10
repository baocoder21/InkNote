import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NzSpinComponent } from 'ng-zorro-antd/spin';
import { NOTE_STATUS_OPTIONS, NoteStatus } from '../../models/note.model';
import { NotebookOption, Tag } from '../../models/organization.model';
import { SearchResult } from '../../models/search.model';

/**
 * "Presentational" component: the list of search results that replaces the folder tree while a search is
 * on. It asks for nothing and stores nothing; the sidebar gives it the results and listens to "show more".
 *
 * The matching words arrive marked in the data (see TextPart) and are drawn with <mark>; there is no
 * innerHTML here, so text from a note can never become markup.
 */
@Component({
  selector: 'app-search-results',
  imports: [RouterLink, RouterLinkActive, NzSpinComponent],
  templateUrl: './search-results.component.html',
  styleUrl: './search-results.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchResultsComponent {
  readonly results = input.required<SearchResult[]>();
  readonly total = input(0);
  readonly query = input('');
  readonly loading = input(false);
  readonly loadingMore = input(false);
  readonly failed = input(false);
  readonly hasMore = input(false);
  // To show where a note lives ("Work / Projects") and the NAMES of its tags.
  readonly notebooks = input<NotebookOption[]>([]);
  readonly tags = input<Tag[]>([]);

  readonly showMore = output<void>();

  private readonly paths = computed(() => new Map(this.notebooks().map((o) => [o.notebook.id, o.path])));
  private readonly tagNames = computed(() => new Map(this.tags().map((t) => [t.id, t.name])));

  protected pathOf(result: SearchResult): string | null {
    return result.notebookId ? (this.paths().get(result.notebookId) ?? null) : null;
  }

  protected tagsOf(result: SearchResult): string[] {
    return result.tagIds.flatMap((id) => this.tagNames().get(id) ?? []).sort((a, b) => a.localeCompare(b));
  }

  protected statusLabel(status: NoteStatus): string {
    return NOTE_STATUS_OPTIONS.find((o) => o.value === status)?.label ?? status;
  }

  protected hasMeta(result: SearchResult): boolean {
    return !!this.pathOf(result) || result.status !== 'None' || this.tagsOf(result).length > 0;
  }
}
