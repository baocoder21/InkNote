import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NzMessageService } from 'ng-zorro-antd/message';
import { AttachmentResolver, ResolvedAttachment } from '../../../attachments/services/attachment-resolver.service';
import { renderMarkdown } from '../../markdown/markdown-renderer';
import { MarkdownPreviewComponent } from './markdown-preview.component';

const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('MarkdownPreviewComponent: files attached to the note', () => {
  let fixture: ComponentFixture<MarkdownPreviewComponent>;
  let known: Map<string, ResolvedAttachment>;
  let resolve: ReturnType<typeof vi.fn>;
  let download: ReturnType<typeof vi.fn>;

  const root = () => fixture.nativeElement as HTMLElement;
  const image = (): HTMLImageElement | null => root().querySelector('img[data-attachment-id]');

  async function waitFor(condition: () => boolean, timeoutMs = 10_000) {
    const start = Date.now();
    while (!condition()) {
      if (Date.now() - start > timeoutMs) throw new Error('Timed out waiting for the preview');
      fixture.detectChanges();
      await new Promise((resolveTimer) => setTimeout(resolveTimer, 25));
    }
  }

  const show = async (source: string) => {
    fixture.componentRef.setInput('source', source);
    await waitFor(() => !!root().querySelector('p'));
  };

  beforeAll(async () => {
    await renderMarkdown('warm up'); // loads Shiki once
  }, 60_000);

  beforeEach(async () => {
    known = new Map();
    resolve = vi.fn(async () => null);
    download = vi.fn(async () => true);
    await TestBed.configureTestingModule({
      imports: [MarkdownPreviewComponent],
      providers: [{ provide: AttachmentResolver, useValue: { known: (id: string) => known.get(id) ?? null, resolve, download } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MarkdownPreviewComponent);
  });

  it('gives an image its address at once when it is already known (no flicker when the preview is drawn again)', async () => {
    known.set(ID, { url: 'blob:known', name: 'cat.png', isImage: true });

    await show(`![cat](attachment:${ID})`);

    expect(image()!.getAttribute('src')).toBe('blob:known');
    expect(resolve).not.toHaveBeenCalled();
    expect(image()!.classList.contains('attachment--loading')).toBe(false);
  });

  it('shows a waiting box while the address is being found, then the picture', async () => {
    let finish!: (value: ResolvedAttachment) => void;
    resolve.mockReturnValue(new Promise((done) => (finish = done)));

    await show(`![cat](attachment:${ID})`);
    await waitFor(() => image()?.classList.contains('attachment--loading') === true);
    expect(image()!.hasAttribute('src')).toBe(false); // nothing to load yet

    finish({ url: 'https://storage.example/cat?sig=1', name: 'cat.png', isImage: true });
    await waitFor(() => image()!.getAttribute('src') === 'https://storage.example/cat?sig=1');

    expect(image()!.classList.contains('attachment--loading')).toBe(false);
    expect(resolve).toHaveBeenCalledWith(ID);
  });

  it('says the file is not available when it cannot be found (not on this device, server out of reach)', async () => {
    resolve.mockResolvedValue(null);

    await show(`![cat](attachment:${ID})`);
    await waitFor(() => image()?.classList.contains('attachment--missing') === true);

    expect(image()!.hasAttribute('src')).toBe(false);
    expect(image()!.getAttribute('alt')).toBe('cat (not available)');
  });

  it('does not show a file that is not an image as a picture', async () => {
    resolve.mockResolvedValue({ url: 'blob:pdf', name: 'report.pdf', isImage: false });

    await show(`![oops](attachment:${ID})`);
    await waitFor(() => image()?.classList.contains('attachment--missing') === true);

    expect(image()!.hasAttribute('src')).toBe(false);
  });

  it.each(['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'file:///etc/passwd', 'ftp://x/y'])(
    'never puts an address of the kind %s on an image, whatever the resolver says',
    async (url) => {
      resolve.mockResolvedValue({ url, name: 'x.png', isImage: true });

      await show(`![x](attachment:${ID})`);
      await waitFor(() => image()?.classList.contains('attachment--missing') === true);

      expect(image()!.hasAttribute('src')).toBe(false);
    },
  );

  it('a click on the link of a file saves it, and does not follow the link', async () => {
    await show(`[report.pdf](attachment:${ID})`);
    const link = root().querySelector<HTMLAnchorElement>('a[data-attachment-id]')!;

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(download).toHaveBeenCalledWith(ID);
  });

  it('tells the user when the file is not available now', async () => {
    const warning = vi.spyOn(TestBed.inject(NzMessageService), 'warning');
    download.mockResolvedValue(false);
    await show(`[report.pdf](attachment:${ID})`);

    root().querySelector<HTMLAnchorElement>('a[data-attachment-id]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => expect(warning).toHaveBeenCalled());
    expect(String(warning.mock.calls[0][0])).toContain('not available');
  });

  it('leaves the clicks on ordinary links alone', async () => {
    await show('[docs](https://example.com)');
    const link = root().querySelector<HTMLAnchorElement>('a')!;

    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(download).not.toHaveBeenCalled();
  });
});
