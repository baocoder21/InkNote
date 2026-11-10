---
paths:
  - "src/frontend/**"
---

# Frontend rules (Angular)

- Standalone components, `ChangeDetectionStrategy.OnPush`, use `inject()` instead of constructor injection.
- State uses Signals / NgRx SignalStore; RxJS only for HTTP, SignalR and debounce. Avoid manual subscriptions when `toSignal` / `async` pipe works.
- Each feature lives in `src/app/features/<name>/` (components, store, services, routes) and is lazy-loaded via `loadChildren`/`loadComponent`.
- All writes go through Dexie first (local-first), then are pushed to the sync queue; components must not call write APIs directly.
- Markdown rendering: always remark → sanitize with DOMPurify before attaching to the DOM. Never use `bypassSecurityTrust*` on user content.
- Styles: SASS; variables/theme centralized in `src/styles/`; no hardcoded colors in components.
- Test with Vitest; E2E with Playwright. A new component needs at least one test for its main logic.
- After adding/changing a feature: update `docs/PROJECT_MAP.md`.
