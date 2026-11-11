import { history } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { vi } from 'vitest';
import { selectionToolbar } from './selection-toolbar';

const views: EditorView[] = [];

function open(doc: string): EditorView {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [history(), selectionToolbar] }) });
  views.push(view);
  return view;
}
const bar = () => document.querySelector<HTMLElement>('.cm-ink-selection-toolbar');
const button = (title: string) => document.querySelector<HTMLButtonElement>(`.cm-ink-selection-toolbar button[title="${title}"]`)!;
const select = (view: EditorView, from: number, to: number) => view.dispatch({ selection: { anchor: from, head: to } });

afterEach(() => {
  while (views.length) {
    const view = views.pop()!;
    view.dom.parentElement?.remove();
    view.destroy();
  }
});

describe('selectionToolbar', () => {
  it('is not there when nothing is selected, even in a focused editor', () => {
    const view = open('hello world');

    view.focus();
    select(view, 3, 3); // only a cursor

    expect(bar()).toBeNull();
  });

  it('shows above the selected text of the focused editor', async () => {
    const view = open('hello world');

    view.focus();
    select(view, 0, 5);

    await vi.waitFor(() => expect(bar()).not.toBeNull());
    expect(bar()!.classList).toContain('cm-tooltip'); // CodeMirror positions it like any tooltip
  });

  it('goes away when the selection is cleared', async () => {
    const view = open('hello world');
    view.focus();
    select(view, 0, 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    select(view, 5, 5);

    await vi.waitFor(() => expect(bar()).toBeNull());
  });

  it('is not shown for a selection of nothing but spaces', () => {
    const view = open('a   b');

    view.focus();
    select(view, 1, 4);

    expect(bar()).toBeNull();
  });

  it('belongs to a FOCUSED editor: it is not shown without focus, and goes away when the focus does', async () => {
    const view = open('hello world');
    select(view, 0, 5);
    expect(bar()).toBeNull(); // selected, but the editor was never focused

    view.focus();
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    view.contentDOM.blur();
    await vi.waitFor(() => expect(bar()).toBeNull());
  });

  it('hides while the mouse button is down (a selection being dragged) and comes back when it is released', async () => {
    const view = open('hello world');
    view.focus();
    select(view, 0, 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 }));
    select(view, 0, 5); // the selection changes while the button is down
    await vi.waitFor(() => expect(bar()).toBeNull());

    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await vi.waitFor(() => expect(bar()).not.toBeNull());
  });

  it('ignores the other mouse buttons (a right click does not start a selection)', async () => {
    const view = open('hello world');
    view.focus();
    select(view, 0, 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    view.contentDOM.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 2 }));
    select(view, 0, 5);

    expect(bar()).not.toBeNull();
  });

  it('has a button for each kind of formatting, each with a name for screen readers', async () => {
    const view = open('hello world');
    view.focus();
    select(view, 0, 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    const titles = Array.from(bar()!.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'));

    expect(titles).toEqual([
      'Heading (click again for a smaller one)',
      'Bold',
      'Italic',
      'Strikethrough',
      'Link',
      'Inline code',
      'Code block',
      'Bulleted list',
      'Numbered list',
      'Task list',
      'Quote',
    ]);
    expect(bar()!.getAttribute('role')).toBe('toolbar');
  });

  it('pressing a button does not take the focus from the editor (the mousedown is cancelled)', async () => {
    const view = open('hello world');
    view.focus();
    select(view, 0, 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    const press = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button('Bold').dispatchEvent(press);

    expect(press.defaultPrevented).toBe(true);
  });

  it('a button formats the selection, and the bar stays for the next click', async () => {
    const view = open('hello world');
    view.focus();
    select(view, 0, 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    button('Bold').click();

    expect(view.state.doc.toString()).toBe('**hello** world');
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('hello');
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    button('Italic').click();

    expect(view.state.doc.toString()).toBe('***hello*** world');
  });

  it.each([
    ['Link', 'see [hello](url) world'],
    ['Bulleted list', '- hello world'],
    ['Quote', '> hello world'],
    ['Inline code', '`hello` world'],
  ])('"%s" does its job on the selected text', async (title, expected) => {
    const view = open(title === 'Link' ? 'see hello world' : 'hello world');
    view.focus();
    const from = view.state.doc.toString().indexOf('hello');
    select(view, from, from + 5);
    await vi.waitFor(() => expect(bar()).not.toBeNull());

    button(title).click();

    expect(view.state.doc.toString()).toBe(expected);
  });
});
