import type { Element, ElementContent, Root, RootContent } from 'hast';
import type { Plugin } from 'unified';

type Child = RootContent | ElementContent;

/** A file attached to a note is written in Markdown as  ![name](attachment:<id>)  or  [name](attachment:<id>). */
export const ATTACHMENT_URL = /^attachment:/i;

/** The id is a GUID chosen by the app. Anything else after "attachment:" is not an attachment and is dropped. */
export const ATTACHMENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turns  attachment:<id>  into  data-attachment-id="<id>".
 *
 * The HTML that comes out has NO src (images) and NO real href (links): where the file is shown from depends on
 * the device (this device's database, or a short-lived address from the server), and the page fills that in
 * afterwards (see MarkdownPreviewComponent). The Markdown of a note therefore never decides what address the browser
 * loads: only a valid GUID gets through, and nothing else the user typed after "attachment:" reaches the page.
 */
function walk(children: Child[]): void {
  for (const node of children) {
    if (node.type !== 'element') continue;

    if (node.tagName === 'img') {
      rewrite(node, 'src');
    } else if (node.tagName === 'a') {
      rewrite(node, 'href', '#');
    }
    walk(node.children);
  }
}

function rewrite(node: Element, property: 'src' | 'href', placeholder?: string): void {
  const value = node.properties?.[property];
  if (typeof value !== 'string' || !ATTACHMENT_URL.test(value)) {
    return; // an ordinary address: not ours
  }

  const id = value.replace(ATTACHMENT_URL, '');
  delete node.properties[property];
  if (ATTACHMENT_ID.test(id)) {
    node.properties['dataAttachmentId'] = id.toLowerCase();
    if (placeholder) {
      node.properties[property] = placeholder;
    }
  }
}

export const rehypeAttachments: Plugin<[], Root> = () => (tree) => walk(tree.children);
