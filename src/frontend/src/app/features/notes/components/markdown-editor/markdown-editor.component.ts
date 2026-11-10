import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  model,
  viewChild,
} from '@angular/core';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorState } from '@codemirror/state';
import { EditorView, placeholder } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { inkEditorTheme } from './ink-editor-theme';

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
}
