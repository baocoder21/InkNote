import { StateEffect, StateField, type EditorState, type Extension } from '@codemirror/state';
import { EditorView, showTooltip, type Tooltip, type TooltipView } from '@codemirror/view';
import {
  cycleHeading,
  insertLink,
  toggleBold,
  toggleBulletList,
  toggleCodeBlock,
  toggleInlineCode,
  toggleItalic,
  toggleNumberedList,
  toggleQuote,
  toggleStrikethrough,
  toggleTaskList,
  type FormatCommand,
} from './markdown-format';

/**
 * A small formatting bar that floats above the selected text (like Inkdrop's): bold, italic, links, lists...
 * It appears while text is selected in the focused editor, and goes away with the selection or when the editor loses focus.
 *
 * It is a CodeMirror "tooltip": the editor positions it next to the selection, flips it below when there is no room above,
 * and moves it when the page scrolls. The buttons run the commands of markdown-format.ts.
 */

interface ToolbarItem {
  title: string;
  /** What is drawn on the button: plain text, or (when `svg` is set) a small picture. Never user content. */
  label: string;
  svg?: string;
  /** CSS class for a letter that must look like its effect (bold B, italic I...). */
  look?: string;
  run: FormatCommand;
}

const SVG_ATTRS = 'viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
const LINK_ICON = `<svg ${SVG_ATTRS}><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.5-1.5"/></svg>`;
const BULLET_ICON = `<svg ${SVG_ATTRS}><path d="M9 6h12M9 12h12M9 18h12"/><circle cx="4" cy="6" r="1" fill="currentColor"/><circle cx="4" cy="12" r="1" fill="currentColor"/><circle cx="4" cy="18" r="1" fill="currentColor"/></svg>`;
const TASK_ICON = `<svg ${SVG_ATTRS}><rect x="3" y="3" width="18" height="18" rx="3"/><path d="m8 12 3 3 5-6"/></svg>`;

/** The buttons, left to right; a `null` is a thin separator between groups. */
const ITEMS: readonly (ToolbarItem | null)[] = [
  { title: 'Heading (click again for a smaller one)', label: 'H', look: 'cm-ink-fmt--heading', run: cycleHeading },
  null,
  { title: 'Bold', label: 'B', look: 'cm-ink-fmt--bold', run: toggleBold },
  { title: 'Italic', label: 'I', look: 'cm-ink-fmt--italic', run: toggleItalic },
  { title: 'Strikethrough', label: 'S', look: 'cm-ink-fmt--strike', run: toggleStrikethrough },
  { title: 'Link', label: 'Link', svg: LINK_ICON, run: insertLink },
  null,
  { title: 'Inline code', label: '</>', look: 'cm-ink-fmt--mono', run: toggleInlineCode },
  { title: 'Code block', label: '{ }', look: 'cm-ink-fmt--mono', run: toggleCodeBlock },
  null,
  { title: 'Bulleted list', label: 'Bulleted list', svg: BULLET_ICON, run: toggleBulletList },
  { title: 'Numbered list', label: '1.', look: 'cm-ink-fmt--mono', run: toggleNumberedList },
  { title: 'Task list', label: 'Task list', svg: TASK_ICON, run: toggleTaskList },
  { title: 'Quote', label: '“', look: 'cm-ink-fmt--quote', run: toggleQuote },
];

/** Builds the bar. Defined once, at module level: CodeMirror recognizes "the same tooltip" by this function and only moves it. */
function createToolbar(view: EditorView): TooltipView {
  const dom = document.createElement('div');
  dom.className = 'cm-ink-selection-toolbar';
  dom.setAttribute('role', 'toolbar');
  dom.setAttribute('aria-label', 'Text formatting');

  for (const item of ITEMS) {
    if (item === null) {
      const separator = document.createElement('span');
      separator.className = 'cm-ink-fmt-separator';
      dom.appendChild(separator);
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cm-ink-fmt ${item.look ?? ''}`.trim();
    button.title = item.title;
    button.setAttribute('aria-label', item.title);
    if (item.svg) {
      button.innerHTML = item.svg; // a constant of this file, never text of a note
    } else {
      button.textContent = item.label;
    }
    // The press must not take the focus away from the editor: that would end the selection (and so remove this bar).
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => {
      item.run(view);
      view.focus();
    });
    dom.appendChild(button);
  }
  return { dom };
}

// ---- when the bar is shown ----

const setFocused = StateEffect.define<boolean>();
const setSelecting = StateEffect.define<boolean>();

/** Is the editor focused, and is the mouse button down (a selection being dragged)? */
const toolbarState = StateField.define<{ focused: boolean; selecting: boolean }>({
  create: () => ({ focused: false, selecting: false }),
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFocused)) {
        value = { ...value, focused: effect.value };
      } else if (effect.is(setSelecting)) {
        value = { ...value, selecting: effect.value };
      }
    }
    return value;
  },
});

/** The bar, or null when it must not show: not focused, still dragging, or nothing (but spaces) selected. */
function toolbarFor(state: EditorState): Tooltip | null {
  const { focused, selecting } = state.field(toolbarState);
  const range = state.selection.main;
  if (!focused || selecting || range.empty || state.sliceDoc(range.from, range.to).trim() === '') {
    return null;
  }
  return { pos: range.from, above: true, arrow: false, create: createToolbar };
}

const toolbarTooltip = StateField.define<Tooltip | null>({
  create: toolbarFor,
  update(tooltip, transaction) {
    const relevant =
      transaction.docChanged || transaction.selection || transaction.effects.some((e) => e.is(setFocused) || e.is(setSelecting));
    return relevant ? toolbarFor(transaction.state) : tooltip;
  },
  provide: (field) => showTooltip.compute([field], (state) => state.field(field)),
});

/**
 * While the mouse button is down inside the editor the user is still choosing what to select: the bar waits until the
 * button is released (it would otherwise flicker under the pointer all along the drag).
 */
const trackMouseSelection = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) {
      return false;
    }
    view.dispatch({ effects: setSelecting.of(true) });
    const release = (): void => {
      document.removeEventListener('mouseup', release, true);
      if (view.dom.isConnected) {
        view.dispatch({ effects: setSelecting.of(false) });
      }
    };
    document.addEventListener('mouseup', release, true);
    return false; // CodeMirror goes on with its own handling of the click
  },
});

const toolbarTheme = EditorView.theme({
  '.cm-ink-selection-toolbar': {
    display: 'flex',
    alignItems: 'center',
    gap: '2px',
    padding: '3px',
    borderRadius: '8px',
    boxShadow: '0 4px 14px rgba(0, 0, 0, 0.18)',
    zIndex: '10',
  },
  '.cm-ink-fmt': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '28px',
    height: '28px',
    padding: '0 6px',
    border: '0',
    borderRadius: '5px',
    background: 'transparent',
    color: 'var(--ink-text-muted)',
    font: 'inherit',
    fontSize: '0.9rem',
    lineHeight: '1',
    cursor: 'pointer',
  },
  '.cm-ink-fmt:hover, .cm-ink-fmt:focus-visible': {
    background: 'var(--ink-bg-hover)',
    color: 'var(--ink-text)',
    outline: 'none',
  },
  '.cm-ink-fmt--bold': { fontWeight: '800' },
  '.cm-ink-fmt--italic': { fontStyle: 'italic', fontFamily: 'Georgia, serif' },
  '.cm-ink-fmt--strike': { textDecoration: 'line-through' },
  '.cm-ink-fmt--heading': { fontWeight: '700' },
  '.cm-ink-fmt--mono': { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '0.8rem' },
  '.cm-ink-fmt--quote': { fontFamily: 'Georgia, serif', fontSize: '1.3rem', paddingTop: '6px' },
  '.cm-ink-fmt-separator': {
    width: '1px',
    height: '18px',
    margin: '0 3px',
    background: 'var(--ink-border-strong)',
  },
});

export const selectionToolbar: Extension = [
  toolbarState,
  toolbarTooltip,
  // The bar belongs to a FOCUSED editor: clicking elsewhere (the title, the sidebar) removes it.
  EditorView.focusChangeEffect.of((_state, focusing) => setFocused.of(focusing)),
  trackMouseSelection,
  toolbarTheme,
];
