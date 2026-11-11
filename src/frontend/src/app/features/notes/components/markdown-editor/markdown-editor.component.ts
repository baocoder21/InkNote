import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  model,
  output,
  viewChild,
} from '@angular/core';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { inkEditorTheme } from './ink-editor-theme';
import { selectionToolbar } from './selection-toolbar';

/** Does this drag or paste carry files? */
const hasFiles = (data: DataTransfer | null): boolean => (data?.files?.length ?? 0) > 0;

/**
 * Angular wrapper around CodeMirror 6.
 *
 * CodeMirror keeps its own state (document, cursor, undo history) inside an EditorView.
 * This component keeps that state and the `value` signal in sync in both directions:
 *   typing in the editor  -> value.set(...)           (updateListener)
 *   value changed outside -> view.dispatch(...)       (effect)
 */
@Component({
  selector: 'app-markdown-editor',
  template: `<div #host class="editor-host"></div>`,
  styles: `
    :host {
      display: block;
      height: 100%;
      min-height: 0;
    }
    .editor-host {
      height: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkdownEditorComponent {
  /** The Markdown text. Use as [(value)]="signal" for two-way binding. */
  readonly value = model.required<string>();

  /**
   * Files pasted or dropped into the editor. The editor does not know what to do with them (that is the note's
   * business: store them, queue the upload, write the Markdown); it only reports them.
   */
  readonly filesAdded = output<File[]>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private view: EditorView | null = null;

  constructor() {
    // The EditorView needs a real DOM element, so it is created after the first render.
    afterNextRender(() => {
      this.view = new EditorView({
        parent: this.host().nativeElement,
        state: EditorState.create({
          doc: this.value(),
          extensions: [
            basicSetup, // line numbers, history (undo/redo), search, bracket matching, ...
            // Markdown syntax + syntax coloring inside fenced code blocks (languages load lazily).
            // base: markdownLanguage = CommonMark PLUS GitHub-flavored Markdown (tables, ~~strikethrough~~,
            // task lists), the same dialect as the preview. The default is plain CommonMark, which
            // would not recognize those, so they would look unstyled while typing.
            markdown({ base: markdownLanguage, codeLanguages: languages }),
            EditorView.lineWrapping,
            placeholder('Write Markdown here...'),
            EditorView.contentAttributes.of({ 'aria-label': 'Note content' }),
            inkEditorTheme, // colors from the --ink-* variables of the current theme
            selectionToolbar, // the formatting bar that floats above selected text
            EditorView.domEventHandlers({
              paste: (event) => this.takeFiles(event, event.clipboardData),
              drop: (event, view) => {
                if (!hasFiles(event.dataTransfer)) {
                  return false;
                }
                // The text cursor goes where the file was dropped, so that is where its Markdown will be written.
                const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
                if (position !== null) {
                  view.dispatch({ selection: { anchor: position } });
                }
                return this.takeFiles(event, event.dataTransfer);
              },
              // Without this the browser would not accept a drop here at all (it would open the file).
              dragover: (event) => {
                if (!hasFiles(event.dataTransfer)) {
                  return false;
                }
                event.preventDefault();
                return true;
              },
            }),
            EditorView.updateListener.of((update) => {
              if (update.docChanged) {
                this.value.set(update.state.doc.toString());
              }
            }),
          ],
        }),
      });
    });

    // Text changed from outside (another note opened, note saved...): update the editor,
    // unless it already shows exactly this text (the change came from typing).
    effect(() => {
      const text = this.value();
      const view = this.view;
      if (view && view.state.doc.toString() !== text) {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      }
    });

    inject(DestroyRef).onDestroy(() => this.view?.destroy());
  }

  /** Writes text at the cursor (replacing what is selected) and keeps the editor focused. */
  insertText(text: string): void {
    const view = this.view;
    if (view) {
      view.dispatch({ ...view.state.replaceSelection(text), scrollIntoView: true });
      view.focus();
    }
  }

  private takeFiles(event: Event, data: DataTransfer | null): boolean {
    const files = Array.from(data?.files ?? []);
    if (files.length === 0) {
      return false; // text: CodeMirror pastes it as usual
    }
    event.preventDefault();
    this.filesAdded.emit(files);
    return true;
  }
}
