import { EditorSelection, type ChangeSpec, type Line, type SelectionRange } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';

/**
 * Formatting commands for the Markdown editor: what the buttons of the selection toolbar do.
 *
 * Each command takes the EditorView, changes the text through ONE transaction (so one Ctrl+Z undoes it) and returns true.
 * They are plain functions of the view, so they can be tested without a toolbar, and later be given a keyboard shortcut.
 * They act like switches: using one again on the same text takes the formatting away.
 */
export type FormatCommand = (view: EditorView) => boolean;

// ---------------------------------------------------------------------------------------------------------------------
// Around the selected text: **bold**, *italic*, ~~strikethrough~~, `code`

/**
 * Puts `marker` before and after the selected text, or takes it away when it is already there (either just outside the
 * selection, or at its two ends). The selection stays on the text itself, so the command can be used again at once.
 */
export function toggleWrap(marker: string): FormatCommand {
  const length = marker.length;
  return (view) => {
    const doc = view.state.doc;
    view.dispatch(
      view.state.changeByRange((range) => {
        const { from, to } = range;
        const before = doc.sliceString(Math.max(0, from - length), from);
        const after = doc.sliceString(to, Math.min(doc.length, to + length));
        // A single "*" next to another "*" is part of **bold**, not of *italic*: that is not "already italic".
        const partOfLongerMark =
          length === 1 && (doc.sliceString(Math.max(0, from - 2), from - 1) === marker || doc.sliceString(to + 1, to + 2) === marker);

        if (before === marker && after === marker && !partOfLongerMark) {
          return {
            changes: [
              { from: from - length, to: from },
              { from: to, to: to + length },
            ],
            range: EditorSelection.range(from - length, to - length),
          };
        }

        const text = doc.sliceString(from, to);
        if (text.length >= 2 * length && text.startsWith(marker) && text.endsWith(marker) && !partOfLongerMark) {
          return {
            changes: { from, to, insert: text.slice(length, text.length - length) },
            range: EditorSelection.range(from, to - 2 * length),
          };
        }

        return {
          changes: [
            { from, insert: marker },
            { from: to, insert: marker },
          ],
          range: EditorSelection.range(from + length, to + length),
        };
      }),
    );
    return true;
  };
}

export const toggleBold = toggleWrap('**');
export const toggleItalic = toggleWrap('*');
export const toggleStrikethrough = toggleWrap('~~');
export const toggleInlineCode = toggleWrap('`');

// ---------------------------------------------------------------------------------------------------------------------
// Link

const WEB_ADDRESS = /^https?:\/\/\S+$/i;

/**
 * Makes the selection a link: `[text](url)` with the word "url" selected, ready to be typed over. When the selected text
 * is itself a web address it becomes the target: `[link](https://...)` with "link" selected.
 */
export const insertLink: FormatCommand = (view) => {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.doc.sliceString(range.from, range.to);
      if (WEB_ADDRESS.test(text)) {
        const insert = `[link](${text})`;
        return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(range.from + 1, range.from + 5) };
      }
      const insert = `[${text}](url)`;
      const urlStart = range.from + text.length + 3;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.range(urlStart, urlStart + 3) };
    }),
  );
  return true;
};

// ---------------------------------------------------------------------------------------------------------------------
// Whole lines: headings, lists, quotes, code blocks

/** The lines the selection touches (a selection that ends at the very start of a line does not touch that line). */
function linesOf(view: EditorView, range: SelectionRange): Line[] {
  const doc = view.state.doc;
  const first = doc.lineAt(range.from).number;
  let last = doc.lineAt(range.to).number;
  if (!range.empty && doc.line(last).from === range.to && last > first) {
    last--;
  }
  return Array.from({ length: last - first + 1 }, (_, i) => doc.line(first + i));
}

/** Every distinct line touched by any of the selections, in order (two cursors on one line count once). */
function selectedLines(view: EditorView): Line[] {
  const byStart = new Map<number, Line>();
  for (const range of view.state.selection.ranges) {
    for (const line of linesOf(view, range)) {
      byStart.set(line.from, line);
    }
  }
  return [...byStart.values()].sort((a, b) => a.from - b.from);
}

const HEADING = /^(#{1,6})[ \t]+/;

/**
 * Cycles the heading of the selected lines: plain text, then "# ", "## ", "### ", then plain text again. (Levels 4 to 6
 * are still typed by hand; the button goes back to plain text from them.)
 */
export const cycleHeading: FormatCommand = (view) => {
  const changes: ChangeSpec[] = [];
  for (const line of selectedLines(view)) {
    const match = HEADING.exec(line.text);
    const level = match ? match[1].length : 0;
    const next = level >= 1 && level <= 2 ? level + 1 : level === 0 ? 1 : 0;
    changes.push({ from: line.from, to: line.from + (match?.[0].length ?? 0), insert: next === 0 ? '' : `${'#'.repeat(next)} ` });
  }
  view.dispatch({ changes });
  return true;
};

type LineKind = 'bullet' | 'ordered' | 'task' | 'quote';

// What each kind looks like at the start of a line (after the indentation). `task` comes before `bullet` in the list
// checks because "- [ ] x" is also a bullet.
const PREFIX: Readonly<Record<LineKind, RegExp>> = {
  task: /^[-*+][ \t]+\[[ xX]\][ \t]+/,
  bullet: /^[-*+][ \t]+/,
  ordered: /^\d+[.)][ \t]+/,
  quote: /^>[ \t]?/,
};
const LIST_KINDS: readonly LineKind[] = ['task', 'bullet', 'ordered'];

/** The kind of list or quote a line (without its indentation) already has, if any. */
function kindOf(rest: string, family: readonly LineKind[]): { kind: LineKind; length: number } | null {
  for (const kind of family) {
    const match = PREFIX[kind].exec(rest);
    if (match) {
      return { kind, length: match[0].length };
    }
  }
  return null;
}

/**
 * Switches the selected lines to a list item / task / quote, or back to plain text when ALL of them already are one.
 * A line that is another kind of list changes into this one (a bullet becomes a number); blank lines are left alone;
 * the indentation of nested items is kept; numbers count up from 1 in the order of the lines.
 */
export function toggleLines(kind: LineKind): FormatCommand {
  const family: readonly LineKind[] = kind === 'quote' ? ['quote'] : LIST_KINDS;
  return (view) => {
    const lines = selectedLines(view).filter((line) => line.text.trim() !== '');
    if (lines.length === 0) {
      return false;
    }
    const parts = lines.map((line) => {
      const indent = /^[ \t]*/.exec(line.text)![0];
      return { line, indent, existing: kindOf(line.text.slice(indent.length), family) };
    });
    const remove = parts.every((p) => p.existing?.kind === kind);

    const changes: ChangeSpec[] = parts.map((p, index) => {
      const start = p.line.from + p.indent.length;
      const end = start + (p.existing?.length ?? 0);
      const prefix = remove ? '' : kind === 'ordered' ? `${index + 1}. ` : kind === 'task' ? '- [ ] ' : kind === 'bullet' ? '- ' : '> ';
      return { from: start, to: end, insert: prefix };
    });
    view.dispatch({ changes });
    return true;
  };
}

export const toggleBulletList = toggleLines('bullet');
export const toggleNumberedList = toggleLines('ordered');
export const toggleTaskList = toggleLines('task');
export const toggleQuote = toggleLines('quote');

const FENCE = /^\s*(```|~~~)/;

/**
 * Puts the selected lines in a fenced code block, or takes the fences away when the lines are already between two.
 */
export const toggleCodeBlock: FormatCommand = (view) => {
  const lines = selectedLines(view);
  if (lines.length === 0) {
    return false;
  }
  const doc = view.state.doc;
  const first = lines[0];
  const last = lines[lines.length - 1];
  const above = first.number > 1 ? doc.line(first.number - 1) : null;
  const below = last.number < doc.lines ? doc.line(last.number + 1) : null;

  if (above && below && FENCE.test(above.text) && FENCE.test(below.text)) {
    view.dispatch({
      changes: [
        { from: above.from, to: above.to + 1 }, // the opening fence and its line break
        { from: below.from - 1, to: below.to }, // the line break and the closing fence
      ],
    });
    return true;
  }
  view.dispatch({
    changes: [
      { from: first.from, insert: '```\n' },
      { from: last.to, insert: '\n```' },
    ],
  });
  return true;
};
