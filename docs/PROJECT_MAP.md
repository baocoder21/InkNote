# PROJECT MAP

> Project map for locating code quickly without reading the whole repo. Always update it when the structure changes (skill `update-project-map`).
> Status: **Phase 3 done (pending user review)** – Notes CRUD API + Angular notes UI with a CodeMirror Markdown editor, live preview (KaTeX, Shiki, Mermaid, DOMPurify) and autosave.

## Backend (`src/backend/`)

| Module | Responsibility | Location | Main endpoints |
|---|---|---|---|
| Notes | Note CRUD (revisions later) | `InkNote.Api/Modules/Notes/` (`Domain`, `Application`, `Infrastructure`, `Api`, `NotesModule.cs`) | `GET/POST /api/notes`, `GET/PUT/DELETE /api/notes/{id}` |
| Notebooks/Tags | Nested notebooks, tags | _(not created)_ | |
| Auth | Identity, JWT, refresh token | _(not created)_ | |
| Sync | Client↔server sync, SignalR hub | _(not created)_ | |
| Search | Full-text (tsvector, pg_trgm) | _(not created)_ | |
| Attachments | Upload, object storage | _(not created)_ | |

## Frontend (`src/frontend/`)

| Feature | Description | Location | Main store / service |
|---|---|---|---|
| notes | Notes list + Markdown editor (create/edit/delete, Edit/Split/Preview modes, autosave, Ctrl+S, 409 conflict banner, saves the draft when switching notes). Routes `/notes`, `/notes/:id` | `src/app/features/notes/` (`models/`, `services/notes-api.service.ts`, `store/notes.store.ts`, `components/{notes-page,notes-list,note-editor,note-empty,markdown-editor,markdown-preview}`, `markdown/`, `notes.routes.ts`) | `NotesStore` (SignalStore), `NotesApi` |
| markdown pipeline | Markdown text -> sanitized HTML | `features/notes/markdown/`: `markdown-renderer.ts` (`renderMarkdown`: remark+GFM+math -> rehype+KaTeX+Shiki -> DOMPurify), `rehype-mermaid-blocks.ts`, `highlighter.ts` (Shiki languages: add here), `mermaid-runner.ts` (lazy Mermaid) | `renderMarkdown()` |
| editor components | `MarkdownEditorComponent` (CodeMirror 6 wrapper, `[(value)]`), `MarkdownPreviewComponent` (debounced render; the only place that sets `innerHTML`) | `features/notes/components/markdown-{editor,preview}/` | |
| search | Search box + results | _(Phase 6)_ | |
| sidebar | Notebooks, tags | _(not created)_ | |
| auth | Login/register | _(not created)_ | |
| sync | Dexie + sync queue | _(not created)_ | |

## Database

| Table | Owning module | Notes |
|---|---|---|
| `notes` (id uuid, title, content, created_at, updated_at, version, is_deleted) | Notes | Soft delete via query filter; `version` is a concurrency token; migration `InitialCreate` |
| Notebook, Tag, NoteTag, Attachment, NoteRevision, User | _(not created)_ | see PLAN.md §4 |

## Key entry points

- `global.json` – pins .NET SDK 9.0.x
- `.config/dotnet-tools.json` – local tool manifest (`dotnet-ef` 9.x); run EF commands as `dotnet dotnet-ef ...`
- `docker-compose.yml` – local PostgreSQL 17 (`db`, host port **5433** because a Windows PostgreSQL service owns 5432, volume `inknote-db-data`)
- `src/backend/InkNote.sln` – solution; `src/backend/InkNote.Api/` – web API project; `src/backend/InkNote.Api.Tests/` – xUnit tests
- `src/backend/InkNote.Api/Program.cs` – DI registration, DbContext, ProblemDetails, CORS, pipeline, `GET /api/health`
- `src/backend/InkNote.Api/Persistence/AppDbContext.cs` – single shared DbContext; `Persistence/Migrations/` – EF migrations
- Connection string `ConnectionStrings:Default` – set with `dotnet user-secrets` (not in repo); API docs UI (Swagger UI): `/swagger`, OpenAPI JSON: `/openapi/v1.json` (Development only)
- `src/backend/InkNote.Api.Tests/ApiFixture.cs` – Testcontainers PostgreSQL + in-memory API; `NotesApiTests.cs` – endpoint tests
- `src/backend/InkNote.Api/appsettings.Development.json` – `Cors:AllowedOrigins` (Angular dev server)
- API dev URL: `http://localhost:5032` (see `Properties/launchSettings.json`)
- `src/frontend/` – Angular 22 workspace (standalone, SCSS, Vitest, no SSR); dev URL `http://localhost:4200`
- `src/frontend/src/app/app.config.ts` – providers: router (with input binding), `provideHttpClient`, `provideUi()`
- `src/frontend/src/app/core/ui.providers.ts` – `provideUi()`: ng-zorro locale, registered icons (add new icons here), no-animation, `NzModalService`; also used by component tests
- `src/frontend/src/app/app.routes.ts` – `/` → `/notes`; `notes` lazy-loads `features/notes/notes.routes.ts`
- `src/frontend/src/app/app.ts|html` – shell: top bar and `<router-outlet>` (toasts/confirm dialogs come from `NzMessageService`/`NzModalService`, no global component)
- `src/frontend/src/app/core/api.config.ts` – API base URL (`http://localhost:5032`)
- `src/frontend/src/styles.scss` + `src/styles/_tokens.scss` (design tokens `--ink-*`, the only place with raw colors) + `_base.scss` + `_markdown.scss` (preview styles, global); `ng-zorro-antd.variable.min.css` and `katex/dist/katex.min.css` are added in `angular.json`
- `src/frontend/src/test-setup.ts` – test-only patches for jsdom (layout APIs CodeMirror needs); registered as `setupFiles` in `angular.json`
- `package.json` `overrides.katex` – forces a single patched KaTeX (0.19.1) for `rehype-katex`/`remark-math` (older nested copies had an advisory)
- Frontend stack: `ng-zorro-antd` 22 (MIT), `@angular/cdk`, `@ngrx/signals` (Phase 2); `codemirror` 6 + `@codemirror/*`, `unified`/`remark-*`/`rehype-*`, `katex`, `shiki`, `@shikijs/rehype`, `dompurify`, `mermaid` (Phase 3). Light theme only (no dark mode).
