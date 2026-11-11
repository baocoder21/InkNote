import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension, Range } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * Makes the editor LOOK like the preview while you type: a "# Title" line is big and bold, a
 * "> quote" has its bar, a fenced block has its box, and so on. The Markdown marks (#, *, >)
 * stay visible, so what you see is still exactly what is in the file.
 *
 * Why this is a plugin: CodeMirror's HighlightStyle styles individual pieces of text (bold,
 * italic, strikethrough, inline code: see ink-editor-theme.ts), but it cannot change the size of
 * a whole line, and the "#" of a heading is a different piece from its text. A LINE decoration
 * adds a CSS class to the whole line, so the "#" and the title grow together.
 *
 * It walks the Markdown syntax tree (the same one used for coloring) and maps node names to
 * classes; the CSS for the classes is in `liveStyleTheme` below.
 */

// Markdown syntax-tree node name -> CSS class put on every line that node covers.
const LINE_CLASS: Readonly<Record<string, string>> = {
  ATXHeading1: 'cm-md-h1',
  ATXHeading2: 'cm-md-h2',
  ATXHeading3: 'cm-md-h3',
  ATXHeading4: 'cm-md-h4',
  ATXHeading5: 'cm-md-h5',
  ATXHeading6: 'cm-md-h6',
  SetextHeading1: 'cm-md-h1', // "Title" underlined with ===
  SetextHeading2: 'cm-md-h2', // "Title" underlined with ---
  Blockquote: 'cm-md-quote',
  ListItem: 'cm-md-list', // "- text", "1. text", "- [ ] text" (and the lines that continue or nest inside it)
  FencedCode: 'cm-md-code',
  CodeBlock: 'cm-md-code', // indented code
  Table: 'cm-md-table',
  HorizontalRule: 'cm-md-hr',
};

/** Pure function (state in, decorations out) so it can be tested without a rendered editor. */
export function lineDecorations(
  state: EditorState,
  scanRanges: readonly { from: number; to: number }[],
  tree: ReturnType<typeof syntaxTree> = syntaxTree(state), // tests pass a fully parsed tree; the editor parses in the background
): DecorationSet {
  // line start -> classes. One line can match several nodes (a heading inside a quote), and a
  // decoration set must be built in position order, so collect first and add afterwards.
  const classesByLine = new Map<number, Set<string>>();

  for (const { from, to } of scanRanges) {
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const cls = LINE_CLASS[node.name];
        if (!cls) {
          return;
        }
        const first = state.doc.lineAt(Math.max(node.from, from)).number;
        const last = state.doc.lineAt(Math.min(node.to, to)).number;
        for (let n = first; n <= last; n++) {
          const start = state.doc.line(n).from;
          let set = classesByLine.get(start);
          if (!set) {
            set = new Set();
            classesByLine.set(start, set);
          }
          set.add(cls);
        }
      },
    });
  }

  const ranges: Range<Decoration>[] = [...classesByLine]
    .sort(([a], [b]) => a - b)
    .map(([start, classes]) => Decoration.line({ class: [...classes].join(' ') }).range(start));
  return Decoration.set(ranges);
}

const liveStylePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = lineDecorations(view.state, view.visibleRanges);
    }

    update(update: ViewUpdate): void {
      // The syntax tree is parsed in the background: it can change without the text changing.
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = lineDecorations(update.state, update.view.visibleRanges);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

const MONO = 'ui-monospace, SFMono-Regular, Consolas, monospace';

/**
 * The CSS of the classes above. Sizes are the same as the preview's headings (the browser's
 * default 2em / 1.5em / 1.17em...), so a "## Title" has the same proportions on both sides.
 */
const liveStyleTheme = EditorView.theme({
  // Lines that carry Markdown marks keep the theme's text color, while a plain paragraph uses --ink-editor-text (black in the
  // Light theme). This rule comes FIRST: a heading or a quote inside a list item has both classes and must win below.
  '.cm-md-list, .cm-md-table, .cm-md-code': { color: 'var(--ink-text)' },

  '.cm-md-h1, .cm-md-h2, .cm-md-h3, .cm-md-h4, .cm-md-h5, .cm-md-h6': {
    color: 'var(--ink-heading)',
    fontWeight: '700',
    lineHeight: '1.35',
  },
  '.cm-md-h1': {
    fontSize: '2em',
    paddingBottom: '0.15em',
    borderBottom: '1px solid var(--ink-border)',
  },
  '.cm-md-h2': {
    fontSize: '1.5em',
    paddingBottom: '0.15em',
    borderBottom: '1px solid var(--ink-border)',
  },
  '.cm-md-h3': { fontSize: '1.17em' },
  '.cm-md-h4': { fontSize: '1em' },
  '.cm-md-h5': { fontSize: '0.9em' },
  '.cm-md-h6': { fontSize: '0.85em' },

  // Quote: the same bar and color as the preview's <blockquote>.
  '.cm-md-quote': {
    color: 'var(--ink-syn-quote)',
    borderLeft: '4px solid var(--ink-syn-mark)',
    paddingLeft: '0.9em !important', // .cm-line sets its own padding with a more specific rule
  },

  // Fenced / indented code and tables: monospace on a box. Tables stay monospace so that the
  // "|" columns keep lining up (the preview draws them as a real table).
  '.cm-md-code, .cm-md-table': {
    fontFamily: MONO,
    fontSize: '0.9em',
  },
  '.cm-md-code': { backgroundColor: 'var(--ink-bg-code)' },

  '.cm-md-hr': { color: 'var(--ink-border-strong)' },
});

export const liveMarkdownStyle: Extension = [liveStylePlugin, liveStyleTheme];
