import { ComponentFixture, TestBed } from '@angular/core/testing';
import { renderMarkdown } from '../../markdown/markdown-renderer';
import { MarkdownPreviewComponent } from './markdown-preview.component';

describe('MarkdownPreviewComponent', () => {
  let fixture: ComponentFixture<MarkdownPreviewComponent>;

  const root = () => fixture.nativeElement as HTMLElement;

  // The preview is debounced and rendering is asynchronous: poll until the condition holds.
  async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the preview');
      fixture.detectChanges();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  beforeAll(async () => {
    await renderMarkdown('warm up'); // loads Shiki once
  }, 60_000);

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MarkdownPreviewComponent] }).compileComponents();
    fixture = TestBed.createComponent(MarkdownPreviewComponent);
  });

  it('renders the Markdown as HTML', async () => {
    fixture.componentRef.setInput('source', '# Title\n\nSome **bold** text');
    await waitFor(() => !!root().querySelector('h1'));

    expect(root().querySelector('h1')?.textContent).toBe('Title');
    expect(root().querySelector('strong')?.textContent).toBe('bold');
  });

  it('updates when the source changes', async () => {
    fixture.componentRef.setInput('source', '# First');
    await waitFor(() => root().querySelector('h1')?.textContent === 'First');

    fixture.componentRef.setInput('source', '# Second');
    await waitFor(() => root().querySelector('h1')?.textContent === 'Second');
  });

  it('never puts dangerous HTML into the page', async () => {
    fixture.componentRef.setInput(
      'source',
      'safe text\n\n<img src=x onerror=alert(1)>\n\n[bad](javascript:alert(1))',
    );
    await waitFor(() => (root().textContent ?? '').includes('safe text'));

    expect(root().querySelector('img')).toBeNull();
    expect(root().querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(root().innerHTML).not.toContain('onerror');
    expect(root().innerHTML).not.toContain('javascript:');
  });
});
