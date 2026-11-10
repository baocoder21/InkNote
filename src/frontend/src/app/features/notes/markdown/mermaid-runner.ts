let initialized = false;

/**
 * Draws every <pre class="mermaid"> inside `root` as an SVG diagram.
 * Mermaid is big, so it is downloaded (dynamic import) only when a note really has a diagram.
 */
export async function renderMermaidDiagrams(root: HTMLElement): Promise<void> {
  const nodes = Array.from(root.querySelectorAll<HTMLElement>('pre.mermaid'));
  if (nodes.length === 0) {
    return;
  }

  try {
    const { default: mermaid } = await import('mermaid');
    if (!initialized) {
      // securityLevel 'strict': Mermaid itself escapes the diagram text and disables clicks/scripts.
      mermaid.initialize({ startOnLoad: false, securityLevel: 'strict' });
      initialized = true;
    }
    // suppressErrors: a diagram with a syntax error shows Mermaid's error picture instead of throwing.
    await mermaid.run({ nodes, suppressErrors: true });
  } catch {
    // The preview was replaced while Mermaid was drawing (the user kept typing): ignore.
  }
}
