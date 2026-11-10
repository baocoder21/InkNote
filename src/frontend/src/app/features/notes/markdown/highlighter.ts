import { createCssVariablesTheme, createHighlighterCore, type HighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';

// A "CSS variables" theme: instead of fixed colors, Shiki writes color: var(--ink-code-token-keyword)
// and so on. The variables are defined per theme in styles/_tokens.scss, so code blocks follow
// the current theme (light / dark / warm) without being rendered again.
const inkTheme = createCssVariablesTheme({
  name: 'ink',
  variablePrefix: '--ink-code-',
  variableDefaults: {},
  fontStyle: true,
});

export const CODE_THEME = 'ink';

let highlighter: Promise<HighlighterCore> | null = null;

/**
 * Shiki highlighter, created once and shared. Only the languages listed here are
 * bundled (each one is loaded on demand with import()); other fences fall back to plain text.
 * Add a language by adding one line below.
 */
export function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [inkTheme],
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
