import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InjectionToken,
  effect,
  inject,
  input,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, from, of, switchMap } from 'rxjs';
import { ThemeService } from '../../../../core/theme.service';
import { renderMarkdown } from '../../markdown/markdown-renderer';
import { renderMermaidDiagrams } from '../../markdown/mermaid-runner';

/**
 * How long the preview waits after the last keystroke before rendering. An injection token so
 * tests can change it. Short on purpose: rendering takes 10-120 ms, so the wait is most of the
 * delay the user sees.
 */
export const PREVIEW_DELAY_MS = new InjectionToken<number>('PREVIEW_DELAY_MS', {
  providedIn: 'root',
  factory: () => 50,
});

/**
 * Shows the HTML rendered from Markdown.
 *
 * Why not [innerHTML]="html"? Angular's built-in sanitizer would strip the inline styles
 * that KaTeX and Shiki need. The HTML we set here has ALREADY been cleaned by DOMPurify
 * inside renderMarkdown(), so this is the one place where we set innerHTML ourselves.
 * Never set innerHTML from user content anywhere else.
 */
@Component({
  selector: 'app-markdown-preview',
  template: `<div #host class="markdown-body"></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownPreviewComponent {
  readonly source = input.required<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly delayMs = inject(PREVIEW_DELAY_MS);
  private readonly theme = inject(ThemeService);

  // RxJS for the "stream" part: wait until the user pauses typing, then render; if a newer
  // text arrives while an older one is still rendering, switchMap drops the old result.
  private readonly html = toSignal(
    toObservable(this.source).pipe(
      debounceTime(this.delayMs),
      switchMap((text) =>
        from(renderMarkdown(text)).pipe(
          catchError(() => of('<p><em>The preview could not be rendered.</em></p>')),
        ),
      ),
    ),
    { initialValue: '' },
  );

  constructor() {
    effect(() => {
      const element = this.host().nativeElement;
      const theme = this.theme.theme(); // a theme change draws the diagrams again, in the new colors
      element.innerHTML = this.html(); // already sanitized, see the class comment
      void renderMermaidDiagrams(element, theme);
    });
  }
}
