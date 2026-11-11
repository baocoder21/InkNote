import { history, undo } from '@codemirror/commands';
import { EditorSelection, EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
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
} from './markdown-format';

const views: EditorView[] = [];

/** An editor holding `doc`, with `selected` (the first occurrence of that text) selected. No text selected = a cursor at the end. */
function editor(doc: string, selected?: string): EditorView {
  const from = selected === undefined ? doc.length : doc.indexOf(selected);
  const to = selected === undefined ? doc.length : from + selected.length;
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({ doc, selection: { anchor: from, head: to }, extensions: [history(), EditorState.allowMultipleSelections.of(true)] }),
  });
  views.push(view);
  return view;
}
const text = (view: EditorView) => view.state.doc.toString();
const selectedText = (view: EditorView) => view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);

afterEach(() => {
  while (views.length) {
    const view = views.pop()!;
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe('wrapping the selection: bold, italic, strikethrough, code', () => {
  it('puts the marks around the text and keeps the TEXT selected (so the button can be used again at once)', () => {
    const view = editor('a word here', 'word');

    toggleBold(view);

    expect(text(view)).toBe('a **word** here');
    expect(selectedText(view)).toBe('word');
  });

  it('takes the marks away when they are just outside the selection', () => {
    const view = editor('a **word** here', 'word');

    toggleBold(view);

    expect(text(view)).toBe('a word here');
    expect(selectedText(view)).toBe('word');
  });

  it('takes the marks away when the selection includes them', () => {
    const view = editor('a **word** here', '**word**');

    toggleBold(view);

    expect(text(view)).toBe('a word here');
    expect(selectedText(view)).toBe('word');
  });

  it('is a switch: twice gives the original text', () => {
    const view = editor('a word here', 'word');

    toggleItalic(view);
    toggleItalic(view);

    expect(text(view)).toBe('a word here');
  });

  it.each([
    ['italic', toggleItalic, '*'],
    ['strikethrough', toggleStrikethrough, '~~'],
    ['inline code', toggleInlineCode, '`'],
  ] as const)('%s uses the right mark', (_name, command, mark) => {
    const view = editor('x word y', 'word');

    command(view);

    expect(text(view)).toBe(`x ${mark}word${mark} y`);
  });

  it('does not take the "*" of **bold** for italic: italic on bold text makes it bold AND italic', () => {
    const view = editor('a **word** here', 'word');

    toggleItalic(view);

    expect(text(view)).toBe('a ***word*** here');
  });

  it('works on every selection when there are several', () => {
    const view = editor('one two three');
    view.dispatch({ selection: EditorSelection.create([EditorSelection.range(0, 3), EditorSelection.range(8, 13)]) });

    toggleBold(view);

    expect(text(view)).toBe('**one** two **three**');
  });

  it('is one step for undo', () => {
    const view = editor('a word here', 'word');

    toggleBold(view);
    undo(view);

    expect(text(view)).toBe('a word here');
  });
});

describe('links', () => {
  it('makes [text](url) and selects "url" to be typed over', () => {
    const view = editor('see the docs now', 'the docs');

    insertLink(view);

    expect(text(view)).toBe('see [the docs](url) now');
    expect(selectedText(view)).toBe('url');
  });

  it('uses selected text that is a web address as the target, and selects the label', () => {
    const view = editor('go to https://example.com/a?b=1 now', 'https://example.com/a?b=1');

    insertLink(view);

    expect(text(view)).toBe('go to [link](https://example.com/a?b=1) now');
    expect(selectedText(view)).toBe('link');
  });
});

describe('headings', () => {
  it('cycles plain text, #, ##, ### and back to plain text', () => {
    const view = editor('Title', 'Title');

    const seen = [0, 1, 2, 3].map(() => {
      cycleHeading(view);
      return text(view);
    });

    expect(seen).toEqual(['# Title', '## Title', '### Title', 'Title']);
  });

  it('goes back to plain text from a deeper level typed by hand', () => {
    const view = editor('#### Deep', 'Deep');

    cycleHeading(view);

    expect(text(view)).toBe('Deep');
  });

  it('changes every selected line', () => {
    const view = editor('one\ntwo\nthree', 'one\ntwo');

    cycleHeading(view);

    expect(text(view)).toBe('# one\n# two\nthree');
  });
});

describe('lists, tasks and quotes', () => {
  it('makes a bullet list of the selected lines', () => {
    const view = editor('a\nb\nc', 'a\nb');

    toggleBulletList(view);

    expect(text(view)).toBe('- a\n- b\nc');
  });

  it('takes the bullets away again when every selected line has one', () => {
    const view = editor('- a\n- b', '- a\n- b');

    toggleBulletList(view);

    expect(text(view)).toBe('a\nb');
  });

  it('adds the bullet to the lines that miss it when only some have it', () => {
    const view = editor('- a\nb', '- a\nb');

    toggleBulletList(view);

    expect(text(view)).toBe('- a\n- b');
  });

  it('numbers the lines 1, 2, 3...', () => {
    const view = editor('a\nb\nc', 'a\nb\nc');

    toggleNumberedList(view);

    expect(text(view)).toBe('1. a\n2. b\n3. c');
  });

  it('turns one kind of list into another instead of stacking marks', () => {
    const view = editor('- a\n- b', '- a\n- b');

    toggleNumberedList(view);
    expect(text(view)).toBe('1. a\n2. b');

    toggleTaskList(view);
    expect(text(view)).toBe('- [ ] a\n- [ ] b');

    toggleBulletList(view);
    expect(text(view)).toBe('- a\n- b');
  });

  it('a task takes the task box away again', () => {
    const view = editor('- [ ] a\n- [x] b', '- [ ] a\n- [x] b');

    toggleTaskList(view);

    expect(text(view)).toBe('a\nb');
  });

  it('keeps the indentation of nested items and leaves blank lines alone', () => {
    const view = editor('a\n\n  b', 'a\n\n  b');

    toggleBulletList(view);

    expect(text(view)).toBe('- a\n\n  - b');
  });

  it('does not touch the line where the selection only ends at its very start', () => {
    const view = editor('a\nb\nc');
    view.dispatch({ selection: { anchor: 0, head: 4 } }); // "a\nb\n": ends at the start of "c"

    toggleBulletList(view);

    expect(text(view)).toBe('- a\n- b\nc');
  });

  it('a quote is added and removed, and does not remove a list inside it', () => {
    const view = editor('- a\n- b', '- a\n- b');

    toggleQuote(view);
    expect(text(view)).toBe('> - a\n> - b');

    toggleQuote(view);
    expect(text(view)).toBe('- a\n- b');
  });

  it('works on a line where only a cursor is (no selected text)', () => {
    const view = editor('hello');

    toggleBulletList(view);

    expect(text(view)).toBe('- hello');
  });

  it('does nothing, and says so, on blank lines only', () => {
    const view = editor('\n\n');

    expect(toggleBulletList(view)).toBe(false);
    expect(text(view)).toBe('\n\n');
  });
});

describe('code blocks', () => {
  it('puts the whole lines between fences', () => {
    const view = editor('before\nconst a = 1;\nconst b = 2;\nafter', 'const a = 1;\nconst b');

    toggleCodeBlock(view);

    expect(text(view)).toBe('before\n```\nconst a = 1;\nconst b = 2;\n```\nafter');
  });

  it('takes the fences away when the lines are already between two', () => {
    const view = editor('before\n```\ncode\n```\nafter', 'code');

    toggleCodeBlock(view);

    expect(text(view)).toBe('before\ncode\nafter');
  });

  it('is a switch: twice gives the original text', () => {
    const view = editor('one\ntwo', 'one');

    toggleCodeBlock(view);
    toggleCodeBlock(view);

    expect(text(view)).toBe('one\ntwo');
  });

  it('works at the very start and the very end of the note', () => {
    const view = editor('only line', 'only');

    toggleCodeBlock(view);

    expect(text(view)).toBe('```\nonly line\n```');
  });
});
