import { renderMarkdown } from './markdown-renderer';

function toDom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html; // jsdom does not run scripts or event handlers, so this is safe in a test
  return root;
}

describe('renderMarkdown', () => {
  // The first call loads Shiki and its grammars; give it time.
  beforeAll(async () => {
    await renderMarkdown('warm up');
  }, 60_000);

  describe('features', () => {
    it('renders headings, emphasis and lists', async () => {
      const dom = toDom(await renderMarkdown('# Title\n\nSome **bold** text\n\n- a\n- b'));

      expect(dom.querySelector('h1')?.textContent).toBe('Title');
      expect(dom.querySelector('strong')?.textContent).toBe('bold');
      expect(dom.querySelectorAll('li')).toHaveLength(2);
    });

    it('renders GitHub-flavored tables, task lists and strikethrough', async () => {
      const md = '| a | b |\n|---|---|\n| 1 | 2 |\n\n- [x] done\n- [ ] todo\n\n~~old~~';
      const dom = toDom(await renderMarkdown(md));

      expect(dom.querySelector('table')).not.toBeNull();
      expect(dom.querySelectorAll('input[type="checkbox"]')).toHaveLength(2);
      expect(dom.querySelector('del')?.textContent).toBe('old');
    });

    it('highlights code blocks with Shiki', async () => {
      const dom = toDom(await renderMarkdown('```ts\nconst answer: number = 42;\n```'));

      const pre = dom.querySelector('pre.shiki');
      expect(pre).not.toBeNull();
      expect(pre!.querySelector('span[style*="color"]')).not.toBeNull();
      expect(pre!.textContent).toContain('const answer: number = 42;');
    });

    it('does not fail on an unknown code language', async () => {
      const dom = toDom(await renderMarkdown('```rust\nfn main() {}\n```'));

      expect(dom.querySelector('pre')!.textContent).toContain('fn main() {}');
    });

    it('renders math with KaTeX', async () => {
      const dom = toDom(await renderMarkdown('Inline $E = mc^2$ and block:\n\n$$\\frac{a}{b}$$'));

      expect(dom.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
      // The TeX source stays inside <annotation>, not as loose text in the MathML.
      expect(dom.querySelector('annotation')?.textContent).toBe('E = mc^2');
    });

    it('shows an invalid formula as an error instead of throwing', async () => {
      const dom = toDom(await renderMarkdown('Broken $\\frac{$ formula'));

      expect(dom.textContent).toContain('formula');
      expect(dom.querySelector('.katex-error')).not.toBeNull();
    });

    it('turns a mermaid fence into a placeholder that keeps the source as text', async () => {
      const dom = toDom(await renderMarkdown('```mermaid\ngraph TD; A-->B;\n```'));

      const placeholder = dom.querySelector('pre.mermaid');
      expect(placeholder).not.toBeNull();
      expect(placeholder!.textContent).toContain('A-->B');
      expect(dom.querySelector('pre.shiki')).toBeNull(); // not colorized as code
    });

    it('opens links in a new tab without access to the opener', async () => {
      const dom = toDom(await renderMarkdown('[site](https://example.com)'));

      const link = dom.querySelector('a')!;
      expect(link.getAttribute('href')).toBe('https://example.com');
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    });
  });

  describe('attachments  (![name](attachment:<id>)  and  [name](attachment:<id>))', () => {
    const ID = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

    it('turns an image attachment into an <img> with the id and WITHOUT a src (the page fills the src in)', async () => {
      const img = toDom(await renderMarkdown(`![a cat](attachment:${ID})`)).querySelector('img')!;

      expect(img.getAttribute('data-attachment-id')).toBe(ID);
      expect(img.getAttribute('alt')).toBe('a cat');
      expect(img.hasAttribute('src')).toBe(false);
    });

    it('turns a file attachment into a link that is not an address and does not open a new tab', async () => {
      const link = toDom(await renderMarkdown(`[report.pdf](attachment:${ID})`)).querySelector('a')!;

      expect(link.getAttribute('data-attachment-id')).toBe(ID);
      expect(link.getAttribute('href')).toBe('#');
      expect(link.hasAttribute('target')).toBe(false);
      expect(link.textContent).toBe('report.pdf');
    });

    it('accepts the scheme in any case and writes the id in lower case', async () => {
      const img = toDom(await renderMarkdown(`![x](ATTACHMENT:${ID.toUpperCase()})`)).querySelector('img')!;

      expect(img.getAttribute('data-attachment-id')).toBe(ID);
    });

    it('leaves ordinary images and links alone', async () => {
      const dom = toDom(await renderMarkdown('![x](https://example.com/a.png) [y](https://example.com)'));

      expect(dom.querySelector('img')!.getAttribute('src')).toBe('https://example.com/a.png');
      expect(dom.querySelector('img')!.hasAttribute('data-attachment-id')).toBe(false);
      expect(dom.querySelector('a')!.getAttribute('target')).toBe('_blank'); // the rule for other links still holds
    });

    it('works inside other markup: in a link, a list and a table', async () => {
      const dom = toDom(await renderMarkdown(`- [![x](attachment:${ID})](https://example.com)\n\n| a |\n|---|\n| ![y](attachment:${ID}) |`));

      expect(dom.querySelectorAll('img[data-attachment-id]')).toHaveLength(2);
    });

    // Only a GUID may follow "attachment:": whatever else a user types there must never reach the page.
    const invalid: Record<string, string> = {
      'not a GUID': 'attachment:not-a-guid',
      'a path': 'attachment:../../etc/passwd',
      'javascript: after the scheme': 'attachment:javascript:alert(1)',
      'a GUID followed by more': `attachment:${ID}/../../x`,
      'a GUID with an attribute break-out': `<attachment:${ID}" onerror="alert(1)>`,
      'a GUID with a trailing space': `<attachment:${ID} >`,
      'an external address': 'attachment:https://evil.example/x.png',
      empty: 'attachment:',
    };

    it.each(Object.entries(invalid))('drops an attachment whose id is invalid: %s', async (_name, url) => {
      const dom = toDom(await renderMarkdown(`![x](${url}) [y](${url})`));

      for (const element of Array.from(dom.querySelectorAll('img, a'))) {
        expect(element.hasAttribute('data-attachment-id')).toBe(false);
        expect(element.hasAttribute('src')).toBe(false);
        expect(element.hasAttribute('href')).toBe(false);
        expect(element.hasAttribute('onerror')).toBe(false);
      }
    });

    it('never produces an src or href that holds an attachment: address', async () => {
      const html = await renderMarkdown(`![a](attachment:${ID}) [b](attachment:${ID}) ![c](attachment:bad) [d](attachment:bad)`);

      expect(html.toLowerCase()).not.toMatch(/(src|href)="attachment:/);
    });
  });

  describe('XSS protection', () => {
    const attacks: Record<string, string> = {
      'script tag': '<script>alert(1)</script>',
      'img onerror': '<img src=x onerror=alert(1)>',
      'javascript: markdown link': '[click](javascript:alert(1))',
      'javascript: html link': '<a href="javascript:alert(1)">x</a>',
      'javascript: image': '![x](javascript:alert(1))',
      iframe: '<iframe src="https://evil.example"></iframe>',
      'onclick attribute': '<div onclick="alert(1)">hi</div>',
      'svg onload': '<svg onload=alert(1)></svg>',
      'style tag': '<style>body{display:none}</style>',
      'fake login form': '<form action="https://evil.example"><input name="password"></form>',
      'mXSS payload':
        '<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=alert(1)&gt;">',
    };

    it.each(Object.entries(attacks))('neutralizes: %s', async (_name, markdown) => {
      const html = await renderMarkdown(`before\n\n${markdown}\n\nafter`);
      const dom = toDom(html);

      expect(dom.textContent).toContain('before');
      expect(dom.textContent).toContain('after');
      expect(dom.querySelector('script, iframe, style, form, svg[onload]')).toBeNull();
      // No element may keep an event handler attribute or a javascript: URL.
      for (const element of Array.from(dom.querySelectorAll('*'))) {
        for (const attribute of Array.from(element.attributes)) {
          expect(attribute.name.startsWith('on')).toBe(false);
          expect(attribute.value.toLowerCase()).not.toContain('javascript:');
        }
      }
    });
  });
});
