import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EditorView } from '@codemirror/view';
import { MarkdownEditorComponent } from './markdown-editor.component';

describe('MarkdownEditorComponent', () => {
  let fixture: ComponentFixture<MarkdownEditorComponent>;

  const root = () => fixture.nativeElement as HTMLElement;
  const view = () => EditorView.findFromDOM(root().querySelector<HTMLElement>('.cm-editor')!)!;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MarkdownEditorComponent] }).compileComponents();
    fixture = TestBed.createComponent(MarkdownEditorComponent);
    fixture.componentRef.setInput('value', '# Hello');
    await settle();
  });

  it('shows the initial text in CodeMirror', () => {
    expect(root().querySelector('.cm-content')?.textContent).toContain('# Hello');
    expect(view().state.doc.toString()).toBe('# Hello');
  });

  it('updates the editor when the value changes from outside', async () => {
    fixture.componentRef.setInput('value', 'Another note');
    await settle();

    expect(view().state.doc.toString()).toBe('Another note');
  });

  it('updates the value signal when the user types', async () => {
    const editor = view();
    editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\nmore text' } });
    await settle();

    expect(fixture.componentInstance.value()).toBe('# Hello\nmore text');
  });

  describe('files pasted or dropped into the editor', () => {
    const file = (name = 'photo.png') => new File([new Uint8Array(8)], name, { type: 'image/png' });
    let reported: File[][];

    beforeEach(() => {
      reported = [];
      fixture.componentInstance.filesAdded.subscribe((files) => reported.push(files));
    });

    /** What a browser makes of a paste or a drop. jsdom has no ClipboardEvent or DataTransfer: the part we read is enough. */
    function send(type: 'paste' | 'drop' | 'dragover', files: File[], property: 'clipboardData' | 'dataTransfer') {
      const event = new Event(type, { bubbles: true, cancelable: true });
      // getData is what CodeMirror itself calls when it pastes TEXT.
      Object.defineProperty(event, property, { value: { files, types: files.length > 0 ? ['Files'] : ['text/plain'], getData: () => '' } });
      root().querySelector('.cm-content')!.dispatchEvent(event);
      return event;
    }

    it('reports pasted files and keeps the browser from pasting them as text', () => {
      const event = send('paste', [file('a.png'), file('b.png')], 'clipboardData');

      expect(reported).toHaveLength(1);
      expect(reported[0].map((f) => f.name)).toEqual(['a.png', 'b.png']);
      expect(event.defaultPrevented).toBe(true);
    });

    it('leaves a paste of plain text to CodeMirror: no file is reported and the text is pasted as usual', async () => {
      const editor = view();
      editor.dispatch({ selection: { anchor: editor.state.doc.length } });
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', { value: { files: [], types: ['text/plain'], getData: () => ' pasted words' } });

      root().querySelector('.cm-content')!.dispatchEvent(event);
      await settle();

      expect(reported).toEqual([]);
      expect(editor.state.doc.toString()).toBe('# Hello pasted words');
    });

    it('reports dropped files and keeps the browser from opening them', () => {
      const event = send('drop', [file('dropped.png')], 'dataTransfer');

      expect(reported).toHaveLength(1);
      expect(reported[0][0].name).toBe('dropped.png');
      expect(event.defaultPrevented).toBe(true);
    });

    it('accepts a drag that carries files (the browser refuses a drop unless dragover is cancelled) but not one that carries none', () => {
      expect(send('dragover', [file()], 'dataTransfer').defaultPrevented).toBe(true);
      expect(send('dragover', [], 'dataTransfer').defaultPrevented).toBe(false);
    });
  });

  describe('insertText', () => {
    it('writes at the cursor and the value follows', async () => {
      const editor = view();
      editor.dispatch({ selection: { anchor: 2 } }); // "# |Hello"

      fixture.componentInstance.insertText('[X]');
      await settle();

      expect(editor.state.doc.toString()).toBe('# [X]Hello');
      expect(fixture.componentInstance.value()).toBe('# [X]Hello');
    });

    it('replaces what is selected', async () => {
      const editor = view();
      editor.dispatch({ selection: { anchor: 2, head: 7 } }); // "Hello" selected

      fixture.componentInstance.insertText('World');
      await settle();

      expect(fixture.componentInstance.value()).toBe('# World');
    });
  });
});
