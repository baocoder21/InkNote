import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { NzIconDirective } from 'ng-zorro-antd/icon';
import { SEARCH_MAX_LENGTH, SEARCH_MIN_LENGTH } from '../../models/search.model';

/**
 * "Presentational" component: the search field of the sidebar. It shows the text it is given and reports
 * what the user types; it does not search, debounce or touch the URL (the sidebar does).
 * Escape and the x button both report "cleared".
 */
@Component({
  selector: 'app-search-box',
  imports: [NzIconDirective],
  templateUrl: './search-box.component.html',
  styleUrl: './search-box.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SearchBoxComponent {
  readonly value = input('');

  readonly valueChange = output<string>();
  readonly cleared = output<void>();

  protected readonly maxLength = SEARCH_MAX_LENGTH;
  protected readonly minLength = SEARCH_MIN_LENGTH;

  // Something is typed but it is too short to be searched: say so instead of silently doing nothing.
  protected readonly tooShort = computed(() => {
    const length = this.value().trim().length;
    return length > 0 && length < SEARCH_MIN_LENGTH;
  });

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }
}
