import { createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

export const CODE_THEME = 'github-light';

let highlighter: Promise<HighlighterCore> | null = null;

/**
 * Shiki highlighter, created once and shared. Only the languages listed here are
 * bundled (each one is loaded on demand with import()); other fences fall back to plain text.
 * Add a language by adding one line below.
 */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import('shiki/themes/github-light.mjs')],
    langs: [
      import('shiki/langs/bash.mjs'),
      import('shiki/langs/csharp.mjs'),
      import('shiki/langs/css.mjs'),
      import('shiki/langs/html.mjs'),
      import('shiki/langs/javascript.mjs'),
      import('shiki/langs/json.mjs'),
      import('shiki/langs/markdown.mjs'),
      import('shiki/langs/python.mjs'),
      import('shiki/langs/sql.mjs'),
      import('shiki/langs/typescript.mjs'),
      import('shiki/langs/yaml.mjs'),
    ],
    // JavaScript regex engine: no WebAssembly file to ship or load.
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}
