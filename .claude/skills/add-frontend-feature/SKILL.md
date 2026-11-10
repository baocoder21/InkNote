---
name: add-frontend-feature
description: Create a new feature in InkNote's Angular frontend (editor, notes-list, sidebar...) following the standalone + SignalStore + local-first conventions. Use when adding a new screen, store or service in the frontend.
---

# Add a frontend feature

Read first: `CLAUDE.md`, `.claude/rules/frontend.md`, and the feature's row in `docs/PROJECT_MAP.md`. Read only the files of the relevant feature.

1. Create `src/frontend/src/app/features/<name>/` containing: `<name>.routes.ts` (lazy), `components/`, `store/<name>.store.ts` (NgRx SignalStore), `services/`.
2. Components are standalone, OnPush, use `inject()`. Data comes from the store via signals.
3. Writes: call the Dexie repository first, then push to the sync queue (see the `sync` feature); never call write APIs directly from components.
4. For rendering user Markdown/HTML, use the shared pipeline (remark → DOMPurify); do not reimplement it.
5. Register the route in `app.routes.ts` with `loadChildren`.
6. Add Vitest tests for the store/main logic; run `ng build` and `ng test`.
7. Run the `update-project-map` skill to record the feature and its main store/service.
