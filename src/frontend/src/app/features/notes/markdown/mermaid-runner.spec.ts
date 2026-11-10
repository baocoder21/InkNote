import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMermaidDiagrams } from './mermaid-runner';

// jsdom cannot draw real diagrams, so Mermaid is replaced by a fake that "draws" an <svg>
// (or Mermaid's error picture when the source is "bad"). What we test is OUR logic: the cache.
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    run: vi.fn(async ({ nodes }: { nodes: HTMLElement[] }) => {
      for (const node of nodes) {
        node.innerHTML =
          node.textContent === 'bad'
            ? '<svg aria-roledescription="error"></svg>'
            : '<svg data-drawn="true"></svg>';
      }
    }),
  },
}));

function previewWith(source: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `<pre class="mermaid">${source}</pre>`; // test helper only, fixed text
  document.body.appendChild(root); // must be connected, like the real preview
  return root;
}

async function mermaidRun() {
  return (await import('mermaid')).default.run as ReturnType<typeof vi.fn>;
}

describe('renderMermaidDiagrams', () => {
  beforeEach(async () => {
    (await mermaidRun()).mockClear();
  });

  it('draws a new diagram with Mermaid', async () => {
    const root = previewWith('graph TD; A-->B;');

    await renderMermaidDiagrams(root, 'dark');

    expect(root.querySelector('svg[data-drawn]')).not.toBeNull();
    expect(await mermaidRun()).toHaveBeenCalledTimes(1);
  });

  it('reuses an already drawn diagram instead of drawing it again, without waiting', async () => {
    await renderMermaidDiagrams(previewWith('graph LR; X-->Y;'), 'dark');
    (await mermaidRun()).mockClear();

    // The preview rebuilt its HTML (the user typed somewhere else): same diagram source again.
    const rebuilt = previewWith('graph LR; X-->Y;');
    const done = renderMermaidDiagrams(rebuilt, 'dark');

    // The synchronous part already put the diagram back, before any await finished.
    expect(rebuilt.querySelector('svg[data-drawn]')).not.toBeNull();
    await done;
    expect(await mermaidRun()).not.toHaveBeenCalled();
  });

  it('draws again when the diagram source changed', async () => {
    await renderMermaidDiagrams(previewWith('graph TD; P-->Q;'), 'dark');
    (await mermaidRun()).mockClear();

    await renderMermaidDiagrams(previewWith('graph TD; P-->Q-->R;'), 'dark');

    expect(await mermaidRun()).toHaveBeenCalledTimes(1);
  });

  it('draws a cached diagram again when the theme changes (its colors are baked into the SVG)', async () => {
    await renderMermaidDiagrams(previewWith('graph TD; T1-->T2;'), 'dark');
    (await mermaidRun()).mockClear();

    const sameDiagram = previewWith('graph TD; T1-->T2;');
    await renderMermaidDiagrams(sameDiagram, 'warm');

    expect(await mermaidRun()).toHaveBeenCalledTimes(1); // not served from the dark cache
  });

  it('gives Mermaid the colors of the app theme (base theme + variables)', async () => {
    const mermaid = (await import('mermaid')).default.initialize as ReturnType<typeof vi.fn>;
    mermaid.mockClear();

    await renderMermaidDiagrams(previewWith('graph TD; Z1-->Z2;'), 'light'); // a theme not used before

    expect(mermaid).toHaveBeenCalledTimes(1);
    expect(mermaid.mock.calls[0][0]).toMatchObject({ theme: 'base', securityLevel: 'strict' });
    expect(mermaid.mock.calls[0][0].themeVariables).toHaveProperty('primaryColor');
    expect(mermaid.mock.calls[0][0].themeVariables.darkMode).toBe(false);
  });

  it('does not cache a failed diagram, so fixing it is not blocked by the old error', async () => {
    await renderMermaidDiagrams(previewWith('bad'), 'dark');
    (await mermaidRun()).mockClear();

    await renderMermaidDiagrams(previewWith('bad'), 'dark');

    expect(await mermaidRun()).toHaveBeenCalledTimes(1); // tried again, not served from the cache
  });
});
