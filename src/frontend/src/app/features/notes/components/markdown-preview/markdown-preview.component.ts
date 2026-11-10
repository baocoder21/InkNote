import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  viewChild,
} from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { catchError, debounceTime, from, of, switchMap } from 'rxjs';
import { renderMarkdown } from '../../markdown/markdown-renderer';
import { renderMermaidDiagrams } from '../../markdown/mermaid-runner';

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

  // RxJS for the "stream" part: wait until the user pauses typing, then render; if a newer
  // text arrives while an older one is still rendering, switchMap drops the old result.
  private readonly html = toSignal(
    toObservable(this.source).pipe(
      debounceTime(150),
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
      element.innerHTML = this.html(); // already sanitized, see the class comment
      void renderMermaidDiagrams(element);
    });
  }
}
