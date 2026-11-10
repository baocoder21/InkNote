import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';

type Child = RootContent | ElementContent;

function textOf(node: Child): string {
  if (node.type === 'text') return node.value;
  if (node.type === 'element') return node.children.map(textOf).join('');
  return '';
}

// Markdown  ```mermaid ... ```  becomes  <pre><code class="language-mermaid">...</code></pre>.
function isMermaidBlock(node: Element): boolean {
  if (node.tagName !== 'pre' || node.children.length !== 1) return false;
  const code = node.children[0];
  if (code.type !== 'element' || code.tagName !== 'code') return false;
  const classes = code.properties?.['className'];
  return Array.isArray(classes) && classes.includes('language-mermaid');
}

function walk(children: Child[]): void {
  for (let i = 0; i < children.length; i++) {
    const node = children[i];
    if (node.type !== 'element') continue;

    if (isMermaidBlock(node)) {
      // <pre class="mermaid">source</pre>: the diagram source stays plain *text*.
      // Mermaid draws the SVG later, in the browser (see mermaid-runner.ts).
      children[i] = {
        type: 'element',
        tagName: 'pre',
        properties: { className: ['mermaid'] },
        children: [{ type: 'text', value: textOf(node) }],
      };
    } else {
      walk(node.children);
    }
  }
}

/**
 * rehype plugin: turns mermaid code fences into <pre class="mermaid"> placeholders.
 * It must run BEFORE the syntax highlighter, which would otherwise colorize them as code.
 */
export const rehypeMermaidBlocks: Plugin<[], Root> = () => (tree) => {
  walk(tree.children);
};
