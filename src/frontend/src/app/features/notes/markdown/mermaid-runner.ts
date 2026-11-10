// Drawing a diagram is slow, and the preview rebuilds its whole HTML after every pause in
// typing, so without a cache every diagram would be redrawn (and flicker) for each keystroke.
// Key = the diagram's source text, value = the nodes Mermaid produced (an <svg>).
// We keep DOM nodes and clone them (never an HTML string), so no user-derived text is ever
// parsed as HTML here: this file must not become a second place that sets innerHTML.
const MAX_CACHED_DIAGRAMS = 50;
const drawn = new Map<string, Node[]>();

// A drawn diagram has its colors baked in, so the cache only holds diagrams of ONE theme:
// when the theme changes, it is emptied and the diagrams are drawn again.
let cacheTheme: string | null = null;
let initializedTheme: string | null = null;

function remember(source: string, node: HTMLElement): void {
  // Do not cache a failed drawing: Mermaid's error picture would stick even after a fix.
  if (!node.querySelector('svg') || node.querySelector('svg[aria-roledescription="error"]')) {
    return;
  }
  drawn.delete(source); // re-insert so the newest entry is last
  drawn.set(source, Array.from(node.childNodes, (child) => child.cloneNode(true)));
  if (drawn.size > MAX_CACHED_DIAGRAMS) {
    drawn.delete(drawn.keys().next().value as string); // evict the oldest
  }
}

/**
 * Mermaid's own "base" theme, fed with the colors of the current app theme. Mermaid needs real
 * color values (it computes lighter/darker shades), not var(...), so we read the computed
 * values of our CSS variables at the moment of drawing.
 */
function themeVariables(theme: string): Record<string, string | boolean> {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string) => styles.getPropertyValue(name).trim();
  return {
    darkMode: theme === 'dark',
    background: color('--ink-bg'),
    primaryColor: color('--ink-bg-elevated'),
    primaryTextColor: color('--ink-text'),
    primaryBorderColor: color('--ink-accent'),
    secondaryColor: color('--ink-bg-code'),
    tertiaryColor: color('--ink-bg-sidebar'),
    lineColor: color('--ink-text-muted'),
    textColor: color('--ink-text'),
    mainBkg: color('--ink-bg-elevated'),
    nodeBorder: color('--ink-accent'),
    clusterBkg: color('--ink-bg-code'),
    edgeLabelBackground: color('--ink-bg'),
  };
}

/**
 * Draws every <pre class="mermaid"> inside `root` as an SVG diagram, in the colors of `theme`.
 * Mermaid is big, so it is downloaded (dynamic import) only when a note really has a diagram.
 */
export async function renderMermaidDiagrams(root: HTMLElement, theme: string): Promise<void> {
  if (cacheTheme !== theme) {
    drawn.clear();
    cacheTheme = theme;
  }

  const pending: { node: HTMLElement; source: string }[] = [];

  for (const node of root.querySelectorAll<HTMLElement>('pre.mermaid')) {
    const source = node.textContent ?? '';
    const cached = drawn.get(source);
    if (cached) {
      // Runs synchronously (before the first await): the diagram is back before the browser paints.
      node.replaceChildren(...cached.map((child) => child.cloneNode(true)));
    } else {
      pending.push({ node, source });
    }
  }

  if (pending.length === 0) {
    return;
  }

  try {
    const { default: mermaid } = await import('mermaid');
    if (initializedTheme !== theme) {
      // securityLevel 'strict': Mermaid itself escapes the diagram text and disables clicks/scripts.
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        themeVariables: themeVariables(theme),
      });
      initializedTheme = theme;
    }
    // suppressErrors: a diagram with a syntax error shows Mermaid's error picture instead of throwing.
    await mermaid.run({ nodes: pending.map((p) => p.node), suppressErrors: true });

    for (const { node, source } of pending) {
      // If the preview was replaced meanwhile (the user kept typing) or the theme changed, the
      // node is detached or its colors are outdated: do not cache it.
      if (node.isConnected && cacheTheme === theme) {
        remember(source, node);
      }
    }
  } catch {
    // The preview was replaced while Mermaid was drawing (the user kept typing): ignore.
  }
}
