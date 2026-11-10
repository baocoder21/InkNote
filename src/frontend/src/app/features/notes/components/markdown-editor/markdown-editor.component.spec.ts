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
});
