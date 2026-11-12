import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { liveMarkdownStyle, lineDecorations } from './markdown-live-style';

/** The CSS classes (sorted) the plugin puts on each line of `doc`, one entry per line. */
function classesPerLine(doc: string): string[][] {
  const state = EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] });
  // The editor parses in the background; here the whole document is parsed up front.
  const tree = ensureSyntaxTree(state, state.doc.length, 5000)!;

  const byLine = new Map<number, string[]>();
  for (const cursor = lineDecorations(state, [{ from: 0, to: state.doc.length }], tree).iter(); cursor.value; cursor.next()) {
    byLine.set(state.doc.lineAt(cursor.from).number, String(cursor.value.spec.class).split(' ').sort());
  }
  return Array.from({ length: state.doc.lines }, (_, i) => byLine.get(i + 1) ?? []);
}

describe('liveMarkdownStyle', () => {
  it('marks heading lines with their level, so "#" and the title grow together', () => {
    expect(classesPerLine('# One\n## Two\n###### Six\nplain')).toEqual([
      ['cm-md-h1'],
      ['cm-md-h2'],
      ['cm-md-h6'],
      [],
    ]);
  });

  it('treats an underlined line (Setext) as a heading too', () => {
    expect(classesPerLine('Title\n=====')).toEqual([['cm-md-h1'], ['cm-md-h1']]);
  });

  it('gives list items, numbered items and tasks NO class of their own: the text after a mark is ordinary text', () => {
    expect(classesPerLine('plain\n\n- bullet\n  continued\n  + nested\n1. numbered\n- [ ] task')).toEqual([[], [], [], [], [], [], []]);
  });

  it('still finds a code block inside a list item', () => {
    expect(classesPerLine('- item\n\n  ```js\n  const x = 1;\n  ```')).toEqual([[], [], ['cm-md-code'], ['cm-md-code'], ['cm-md-code']]);
  });

  it('finds a heading and a quote inside a list item', () => {
    expect(classesPerLine('- # Heading in a list\n- > quoted')).toEqual([['cm-md-h1'], ['cm-md-quote']]);
  });

  it('does not treat a "#" without a space as a heading (same rule as the preview)', () => {
    expect(classesPerLine('#hashtag')).toEqual([[]]);
  });

  it('marks every line of a quote and of a fenced code block, fences included', () => {
    expect(classesPerLine('> a\n> b\n\n```ts\nconst x = 1;\n```')).toEqual([
      ['cm-md-quote'],
      ['cm-md-quote'],
      [],
      ['cm-md-code'],
      ['cm-md-code'],
      ['cm-md-code'],
    ]);
  });

  it('combines classes when blocks are nested (a heading inside a quote)', () => {
    expect(classesPerLine('> # Title')).toEqual([['cm-md-h1', 'cm-md-quote']]);
  });

  it('marks table lines (needs GitHub-flavored Markdown) and horizontal rules', () => {
    expect(classesPerLine('| a | b |\n|---|---|\n| 1 | 2 |\n\n---')).toEqual([
      ['cm-md-table'],
      ['cm-md-table'],
      ['cm-md-table'],
      [],
      ['cm-md-hr'],
    ]);
  });

  it('recognizes ~~strikethrough~~ only with the GFM dialect (what the editor component uses)', () => {
    const tree = (state: EditorState) => {
      const names: string[] = [];
      ensureSyntaxTree(state, state.doc.length, 5000)!.iterate({ enter: (n) => void names.push(n.name) });
      return names;
    };
    const doc = '~~gone~~';

    expect(tree(EditorState.create({ doc, extensions: [markdown()] }))).not.toContain('Strikethrough');
    expect(tree(EditorState.create({ doc, extensions: [markdown({ base: markdownLanguage })] }))).toContain(
      'Strikethrough',
    );
  });

  describe('in a real editor', () => {
    it('puts the class on the rendered line and follows the text as it is typed', () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const view = new EditorView({
        parent: host,
        state: EditorState.create({ doc: 'Title', extensions: [markdown({ base: markdownLanguage }), liveMarkdownStyle] }),
      });
      const firstLine = () => host.querySelector('.cm-line')!;
      expect(firstLine().classList.contains('cm-md-h1')).toBe(false);

      view.dispatch({ changes: { from: 0, insert: '# ' } });

      expect(firstLine().classList.contains('cm-md-h1')).toBe(true);
      view.destroy();
      host.remove();
    });
  });
});
