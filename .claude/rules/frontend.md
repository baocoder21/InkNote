---
paths:
  - "src/frontend/**"
---

# Frontend rules (Angular)

- Standalone components, `ChangeDetectionStrategy.OnPush`, use `inject()` instead of constructor injection.
- State uses Signals / NgRx SignalStore; RxJS only for HTTP, SignalR and debounce. Avoid manual subscriptions when `toSignal` / `async` pipe works.
- Each feature lives in `src/app/features/<name>/` (components, store, services, routes) and is lazy-loaded via `loadChildren`/`loadComponent`.
- All writes go through Dexie first (local-first), then are pushed to the sync queue; components must not call write APIs directly.
- Markdown rendering: always go through `renderMarkdown()` (`features/notes/markdown/`: remark → rehype → DOMPurify). Never use `bypassSecurityTrust*` on user content. The ONLY place allowed to set `innerHTML` from user content is `MarkdownPreviewComponent`, and only with the output of `renderMarkdown()`. Any change to the renderer or its sanitize config needs the XSS tests in `markdown-renderer.spec.ts` to pass (add a case for every new attack vector).
- Before adding a library: check its license (`npm view <pkg> license` + its LICENSE file) AND that it works in a real browser. A paid/key-gated library is not acceptable without asking the user.
- Styles: SASS; variables/theme centralized in `src/styles/` (design tokens `--ink-*` in `_tokens.scss`, defined for ALL three themes light/dark/warm: a new token goes in every block); no hardcoded colors in components. After a UI change, look at all three themes in a real browser (tests in jsdom cannot see colors). `ng serve` does not reload `angular.json`: restart it after changing it. Styles for HTML inserted with `innerHTML` must be global (`src/styles/_markdown.scss`).
- Timing-dependent behavior (debounce, autosave) takes its delay from an `InjectionToken` so tests can shorten it; do not rely on fake timers with RxJS/Angular in these tests.
- Test with Vitest; E2E with Playwright. A new component needs at least one test for its main logic. `src/test-setup.ts` patches layout APIs that jsdom lacks (needed by CodeMirror).
- After adding/changing a feature: update `docs/PROJECT_MAP.md`.
