import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { liveMarkdownStyle } from './markdown-live-style';

/**
 * Colors of the editor. Every color is a CSS variable (--ink-*) defined per theme in
 * styles/_tokens.scss, so the same extension serves light, dark and warm: switching theme
 * changes the variables and the editor recolors itself, with no need to rebuild it.
 */
const layout = EditorView.theme({
  '&': {
    height: '100%',
    // All the text, the same color as in the preview. What has a color of its own: headings and quotes
    // (markdown-live-style.ts), the Markdown marks, links and inline code, and code (highlight below).
    color: 'var(--ink-editor-text)',
    backgroundColor: 'var(--ink-bg)',
  },
  '.cm-scroller': {
    overflow: 'auto',
    // Same font and line height as the preview, so prose looks the same on both sides. Code and
    // tables switch to monospace on their own (markdown-live-style.ts).
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    lineHeight: '1.65',
  },
  '.cm-content': { caretColor: 'var(--ink-accent)' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--ink-accent)' },
  '.cm-placeholder': { color: 'var(--ink-text-muted)' },
  '.cm-gutters': {
    backgroundColor: 'var(--ink-bg)',
    color: 'var(--ink-text-muted)',
    border: 'none',
    borderRight: '1px solid var(--ink-border)',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: '0.85em',
  },
  // Inline code (`like this`): the same look as the preview's <code>. Inside a fenced block the
  // line already has the box, so there it is reset.
  '.cm-md-mono': {
    padding: '0.1em 0.3em',
    borderRadius: '4px',
    backgroundColor: 'var(--ink-bg-code)',
    fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
    fontSize: '0.9em',
  },
  '.cm-md-code .cm-md-mono, .cm-md-table .cm-md-mono': {
    padding: '0',
    backgroundColor: 'transparent',
    fontSize: '1em',
  },
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'var(--ink-bg-hover)' },
  '.cm-activeLineGutter': { color: 'var(--ink-text)' },
  // Selected text. The editor has its own selection layer (the real selection is hidden), and
  // CodeMirror's built-in colors are more specific, hence the longer selectors and !important.
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    { backgroundColor: 'var(--ink-bg-selected) !important' },
  '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    backgroundColor: 'var(--ink-bg-hover)',
    outline: '1px solid var(--ink-border-strong)',
  },
  '.cm-tooltip, .cm-panels': {
    backgroundColor: 'var(--ink-bg-elevated)',
    color: 'var(--ink-text)',
    border: '1px solid var(--ink-border-strong)',
  },
  '.cm-panels .cm-textfield': {
    backgroundColor: 'var(--ink-bg)',
    color: 'var(--ink-text)',
    border: '1px solid var(--ink-border-strong)',
  },
  '.cm-searchMatch': { backgroundColor: 'var(--ink-bg-selected)' },
});

/**
 * Syntax colors. In Markdown the "special characters" (the # of a heading, * and _ for emphasis,
 * backticks, > for quotes, - for lists, the brackets of links) are `processingInstruction`:
 * they get their own color (--ink-syn-mark) so that the structure is easy to see.
 */
const highlight = HighlightStyle.define([
  {
    tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: 'var(--ink-syn-heading)',
    fontWeight: '700',
  },
  { tag: tags.processingInstruction, color: 'var(--ink-syn-mark)' },
  { tag: tags.contentSeparator, color: 'var(--ink-syn-mark)' },
  { tag: tags.strong, color: 'var(--ink-syn-strong)', fontWeight: '700' },
  { tag: tags.emphasis, color: 'var(--ink-syn-emphasis)', fontStyle: 'italic' },
  { tag: tags.strikethrough, color: 'var(--ink-text-muted)', textDecoration: 'line-through' },
  { tag: tags.link, color: 'var(--ink-syn-link)', textDecoration: 'underline' },
  { tag: tags.url, color: 'var(--ink-syn-url)' },
  { tag: tags.monospace, class: 'cm-md-mono', color: 'var(--ink-syn-code)' },
  { tag: tags.quote, color: 'var(--ink-syn-quote)' },

  // Code inside fenced blocks.
  {
    tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword, tags.definitionKeyword, tags.tagName],
    color: 'var(--ink-syn-keyword)',
  },
  { tag: [tags.string, tags.special(tags.string), tags.regexp], color: 'var(--ink-syn-string)' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom, tags.literal], color: 'var(--ink-syn-number)' },
  { tag: [tags.comment, tags.lineComment, tags.blockComment], color: 'var(--ink-syn-comment)', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.labelName], color: 'var(--ink-syn-function)' },
  { tag: [tags.propertyName, tags.attributeName], color: 'var(--ink-syn-property)' },
  { tag: [tags.typeName, tags.className, tags.namespace], color: 'var(--ink-syn-type)' },
  { tag: [tags.operator, tags.punctuation, tags.bracket, tags.separator], color: 'var(--ink-syn-punct)' },
  { tag: tags.invalid, color: 'var(--ink-danger)' },
]);

export const inkEditorTheme: Extension = [layout, syntaxHighlighting(highlight), liveMarkdownStyle];
