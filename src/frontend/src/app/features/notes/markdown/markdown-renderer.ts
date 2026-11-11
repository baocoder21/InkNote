import rehypeShikiFromHighlighter from '@shikijs/rehype/core';
import DOMPurify, { type Config } from 'dompurify';
import rehypeKatex from 'rehype-katex';
import rehypeStringify from 'rehype-stringify';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import remarkRehype from 'remark-rehype';
import { unified } from 'unified';
import { CODE_THEME, getHighlighter } from './highlighter';
import { rehypeAttachments } from './rehype-attachments';
import { rehypeMermaidBlocks } from './rehype-mermaid-blocks';

/**
 * Markdown text -> SAFE HTML string.
 *
 *   text --remark--> markdown tree --remark-rehype--> HTML tree --rehype plugins--> HTML string
 *        --DOMPurify--> clean HTML
 *
 * Two layers protect against XSS:
 *  1. remark-rehype drops raw HTML written in the note (allowDangerousHtml is off by default).
 *  2. DOMPurify cleans the final HTML anyway ("defense in depth"), in case a plugin or a
 *     future change lets something dangerous through.
 */
async function createProcessor() {
  const highlighter = await getHighlighter();
  return unified()
    .use(remarkParse)
    .use(remarkGfm) // tables, task lists, strikethrough, autolinks
    .use(remarkMath) // $inline$ and $$block$$ math
    .use(remarkRehype)
    .use(rehypeAttachments) // attachment:<id> becomes data-attachment-id (no src, no real href)
    .use(rehypeMermaidBlocks) // before the highlighter
    .use(rehypeKatex) // a bad formula is shown as a red error block, not an exception
    .use(rehypeShikiFromHighlighter, highlighter, {
      theme: CODE_THEME,
      fallbackLanguage: 'text', // unknown language -> plain text instead of an error
    })
    .use(rehypeStringify)
    .freeze();
}

let processor: ReturnType<typeof createProcessor> | null = null;

const SANITIZE_CONFIG: Config = {
  // KaTeX needs HTML + a little SVG + MathML; Shiki needs inline styles on <span>.
  USE_PROFILES: { html: true, svg: true, mathMl: true },
  // KaTeX keeps the TeX source in <annotation encoding="..."> (text only, never displayed).
  // <annotation-xml> is NOT allowed: it can embed HTML.
  ADD_TAGS: ['annotation'],
  ADD_ATTR: ['encoding'],
  // Nothing a note needs; these could be used to build fake forms (phishing).
  FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'option'],
  FORBID_ATTR: ['action', 'formaction'],
};

// Every link opens in a new tab and cannot access our page (window.opener).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  // (Attachment links are not addresses: the page handles their click itself, see MarkdownPreviewComponent.)
  if (node.tagName === 'A' && node.hasAttribute('href') && !node.hasAttribute('data-attachment-id')) {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export async function renderMarkdown(source: string): Promise<string> {
  processor ??= createProcessor();
  const file = await (await processor).process(source);
  return DOMPurify.sanitize(String(file), SANITIZE_CONFIG);
}
