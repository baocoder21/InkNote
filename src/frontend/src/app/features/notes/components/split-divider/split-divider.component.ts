import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, model, output, signal } from '@angular/core';
import { SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, clampRatio } from './split-ratio';

/** One arrow key moves the divider by this much of the width; with Shift, by the bigger step. */
const STEP = 0.02;
const BIG_STEP = 0.1;

/**
 * The bar between the editor and the preview in Split mode. Drag it with the mouse (or a finger), use the arrow keys when
 * it has the focus, double-click to go back to half and half.
 *
 * It is a "separator" that can be moved (the ARIA pattern "window splitter"), so a screen reader announces it with its
 * value. It lives inside the grid that holds the two panes, and reads that grid's width from its parent element.
 * `ratio` is the share of the width for the LEFT pane. `committed` fires when the user lets go (or presses a key), the
 * moment to remember the choice: during a drag only the live value changes.
 */
@Component({
  selector: 'app-split-divider',
  template: '',
  styleUrl: './split-divider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'separator',
    'aria-orientation': 'vertical',
    'aria-label': 'Resize the editor and the preview',
    tabindex: '0',
    '[attr.aria-valuenow]': 'percent()',
    '[attr.aria-valuemin]': 'min',
    '[attr.aria-valuemax]': 'max',
    '[class.dragging]': 'dragging()',
    '(pointerdown)': 'start($event)',
    '(pointermove)': 'move($event)',
    '(pointerup)': 'end($event)',
    '(pointercancel)': 'end($event)',
    '(keydown)': 'key($event)',
    '(dblclick)': 'reset()',
  },
})
export class SplitDividerComponent {
  /** The share of the width taken by the left pane (0.2 to 0.8). */
  readonly ratio = model.required<number>();
  /** The user finished moving it: the value to remember. */
  readonly committed = output<number>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly min = Math.round(SPLIT_MIN * 100);
  protected readonly max = Math.round(SPLIT_MAX * 100);
  protected readonly percent = computed(() => Math.round(this.ratio() * 100));
  protected readonly dragging = signal(false);

  protected start(event: PointerEvent): void {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault(); // no text selection while dragging, and the focus goes to the divider
    this.host.nativeElement.focus();
    this.host.nativeElement.setPointerCapture?.(event.pointerId); // the moves keep coming even over the editor
    this.dragging.set(true);
  }

  protected move(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    const grid = this.host.nativeElement.parentElement;
    const box = grid?.getBoundingClientRect();
    if (!box || box.width <= 0) {
      return;
    }
    // The left pane is `ratio` of the grid, then comes the divider: its CENTER should be under the pointer.
    const half = this.host.nativeElement.offsetWidth / 2;
    this.ratio.set(clampRatio((event.clientX - box.left - half) / box.width));
  }

  protected end(event: PointerEvent): void {
    if (!this.dragging()) {
      return;
    }
    this.dragging.set(false);
    this.host.nativeElement.releasePointerCapture?.(event.pointerId);
    this.committed.emit(this.ratio());
  }

  protected key(event: KeyboardEvent): void {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let next: number;
    switch (event.key) {
      case 'ArrowLeft':
        next = this.ratio() - step;
        break;
      case 'ArrowRight':
        next = this.ratio() + step;
        break;
      case 'Home':
        next = SPLIT_MIN;
        break;
      case 'End':
        next = SPLIT_MAX;
        break;
      case 'Enter':
        next = SPLIT_DEFAULT;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.set(next);
  }

  protected reset(): void {
    this.set(SPLIT_DEFAULT);
  }

  private set(value: number): void {
    this.ratio.set(clampRatio(value));
    this.committed.emit(this.ratio());
  }
}
