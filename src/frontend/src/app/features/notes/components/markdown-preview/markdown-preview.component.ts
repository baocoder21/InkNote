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
import { NzMessageService } from 'ng-zorro-antd/message';
import { ThemeService } from '../../../../core/theme.service';
import { AttachmentResolver, ResolvedAttachment } from '../../../attachments/services/attachment-resolver.service';
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
  host: { '(click)': 'onClick($event)' },
})
export class MarkdownPreviewComponent {
  readonly source = input.required<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly delayMs = inject(PREVIEW_DELAY_MS);
  private readonly theme = inject(ThemeService);
  private readonly attachments = inject(AttachmentResolver);
  private readonly message = inject(NzMessageService);

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
      this.showAttachments(element);
    });
  }

  /**
   * A click on the link of an attached file (a PDF, a text file...) saves it. The link has no real address: the file is
   * on this device or comes from the server, see AttachmentResolver. (Registered with `host` below, on the whole preview:
   * the links are made again at every render, so one listener on the outside serves them all.)
   */
  protected onClick(event: MouseEvent): void {
    const link = (event.target as Element | null)?.closest<HTMLAnchorElement>('a[data-attachment-id]');
    if (!link) {
      return;
    }
    event.preventDefault();
    void this.attachments.download(link.dataset['attachmentId']!).then((saved) => {
      if (!saved) {
        this.message.warning('This file is not available now. Open it once while online to keep a copy on this device.');
      }
    });
  }

  /**
   * Gives the images of attached files their address. The rendered HTML has NO src for them (see rehype-attachments.ts):
   * it is only filled in here, from this device's copy or from the server, never from text the user typed.
   */
  private showAttachments(element: HTMLElement): void {
    for (const image of Array.from(element.querySelectorAll<HTMLImageElement>('img[data-attachment-id]'))) {
      const id = image.dataset['attachmentId']!;
      const known = this.attachments.known(id);
      if (known) {
        this.show(image, known); // already known: no flicker when the preview is drawn again
        continue;
      }
      image.classList.add('attachment--loading');
      void this.attachments.resolve(id).then((resolved) => {
        if (image.isConnected) {
          this.show(image, resolved);
        }
      });
    }
  }

  private show(image: HTMLImageElement, resolved: ResolvedAttachment | null): void {
    image.classList.remove('attachment--loading');
    const safe = resolved?.isImage && /^(blob:|https?:)/.test(resolved.url);
    if (resolved && safe) {
      image.src = resolved.url;
      return;
    }
    // Not here and not reachable (or not an image): say so, instead of a broken picture.
    image.classList.add('attachment--missing');
    image.alt = image.alt ? `${image.alt} (not available)` : 'Attachment not available';
  }
}
