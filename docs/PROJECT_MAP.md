# PROJECT MAP

> Project map for locating code quickly without reading the whole repo. Always update it when the structure changes (skill `update-project-map`).
> Status: **Phases 0-4 done; Phase 5 (auth) done, pending user review** – backend (accounts, JWT + rotating refresh token, per-user data, Notebooks, Tags, pinning, note status, filters, trash, full-text search; 175 API tests) and frontend (login/register, interceptor, guards, one explorer-style sidebar, searchable pickers + status, editor styled like the preview, trash, three themes; 258 tests). Notes CRUD API + Angular notes UI with a CodeMirror Markdown editor, live preview (KaTeX, Shiki, Mermaid, DOMPurify) and autosave.

## Backend (`src/backend/`)

| Module | Responsibility | Location | Main endpoints |
|---|---|---|---|
| Notes | Note CRUD, pin, status, notebook/tag assignment (revisions later). Owns `NoteTag` join rows | `InkNote.Api/Modules/Notes/` (`Domain`, `Application`, `Infrastructure`, `Api`, `Contracts/INotebookUsage`, `NotesModule.cs`) | `GET /api/notes?notebookId=&tagId=`, `POST /api/notes`, `GET/PUT/DELETE /api/notes/{id}` (DELETE = soft delete, the note goes to the trash), `PUT /api/notes/{id}/organization` (notebook, pin, status, tags); trash: `GET /api/notes/trash`, `GET /api/notes/trash/{id}`, `POST /api/notes/trash/{id}/restore`, `DELETE /api/notes/trash/{id}` (for good), `DELETE /api/notes/trash` (empty) |
| Notebooks | Nested notebooks (flat list with `ParentId`, cycle check, delete refused if not empty) | `InkNote.Api/Modules/Notebooks/` (same layout, `Contracts/INotebookLookup`) | `GET/POST /api/notebooks`, `PUT/DELETE /api/notebooks/{id}` |
| Tags | Tags, unique ignoring case | `InkNote.Api/Modules/Tags/` (same layout, `Contracts/ITagLookup`) | `GET/POST /api/tags`, `PUT/DELETE /api/tags/{id}` |
| Auth | Accounts (ASP.NET Core Identity), JWT access token, rotating refresh token in an HttpOnly cookie, rate limit, adoption of pre-auth data by the first account | `InkNote.Api/Modules/Auth/` (`Domain` AppUser + RefreshToken, `Application` AuthService + TokenService + JwtOptions + DTOs, `Api/AuthEndpoints.cs`, `Infrastructure`, `AuthModule.cs`) + `InkNote.Api/Common/CurrentUser.cs` (`ICurrentUser`) | `POST /api/auth/register`, `/login`, `/refresh` (cookie), `/logout`, `GET /api/auth/me` |
| Sync | Client↔server sync, SignalR hub | _(not created)_ | |
| Search | Full-text search (tsvector + pg_trgm, accent-insensitive, typo-tolerant). NOT a separate module: it is part of Notes (see DECISIONS) | `InkNote.Api/Modules/Notes/Application/NoteSearchService.cs` + `SearchText.cs` (query words, highlight, snippet), `Persistence/SearchFunctions.cs` (`f_unaccent`), mapping in `NoteConfiguration.cs`, migration `AddFullTextSearch` | `GET /api/notes/search?q=&tagId=&notebookId=&page=&pageSize=` |
| Attachments | Upload, object storage | _(not created)_ | |

## Frontend (`src/frontend/`)

| Feature | Description | Location | Main store / service |
|---|---|---|---|
| notes | Markdown editor (title, Edit/Split/Preview switch centered in the toolbar row, autosave + Ctrl+S, no Save button and no status line, 409 conflict banner, saves the draft when switching notes). Routes `/notes`, `/notes/:id` (+ optional `?tag=` filter). Two-column page: ONE sidebar (below) and the open note. Three themes (Light / Dark / Warm), switched from the sidebar header | `src/app/features/notes/` (`models/`, `services/notes-api.service.ts`, `store/notes.store.ts`, `components/{notes-page,note-editor,note-empty,markdown-editor,markdown-preview}`, `markdown/`, `notes.routes.ts`) | `NotesStore` (SignalStore: ALL notes as summaries, open note, save, organization, delete), `NotesApi` |
| markdown pipeline | Markdown text -> sanitized HTML | `features/notes/markdown/`: `markdown-renderer.ts` (`renderMarkdown`: remark+GFM+math -> rehype+KaTeX+Shiki -> DOMPurify), `rehype-mermaid-blocks.ts`, `highlighter.ts` (Shiki languages: add here), `mermaid-runner.ts` (lazy Mermaid) | `renderMarkdown()` |
| editor components | `MarkdownEditorComponent` (CodeMirror 6 wrapper, `[(value)]`, GFM dialect; looks like the preview: `markdown-live-style.ts` adds line classes for headings/quote/code/table, `ink-editor-theme.ts` styles bold/italic/strike/inline code), `MarkdownPreviewComponent` (debounced render; the only place that sets `innerHTML`) | `features/notes/components/markdown-{editor,preview}/` | |
| search | Search box at the top of the sidebar; results replace the tree, matches marked with `<mark>`, "Show more" paging, query in the URL (`?q=`) | `features/notes/components/search-box/` (the field), `components/search-results/` (the list), wired in `notes-sidebar`, `components/_chips.scss` (chips shared with the tree), `store/search.store.ts`, `models/search.model.ts`, `NotesApi.search` | `SearchStore` (query, results, total, paging) |
| sidebar / organization (folders = notebooks, tags, pin) | The single sidebar: toolbar icons (new note, new folder), explorer tree (folders contain their notes; loose notes at the top level); every row has quick-action buttons (folder: new note, new subfolder, rename; note: rename) and a note row shows its status chip and tag names, tag list + `?tag=` filter (replaces the tree by a flat list). Actions live in right-click menus (and a "..." button): folder = new note here / new subfolder / rename / delete; note = pin / delete; tag = delete. Open folders are remembered in `localStorage`. Editor toolbar: pin, notebook picker (searchable), status picker, tag picker (small, searchable) | `features/notes/components/{notes-sidebar,explorer-tree,name-dialog,note-organization}/`, `features/notes/organization/{notebook-tree,explorer-rows}.ts` (pure functions: tree, visible rows, ancestors), `models/organization.model.ts`, `services/organization-api.service.ts` | `OrganizationStore` (notebooks, tags, tree), `NotesStore.updateOrganization` / `forgetTag`, `OrganizationApi` |
| trash | Deleted notes: list, read-only preview, restore, delete forever, empty trash. Route `/notes/trash`; "Trash" link with the count at the bottom of the sidebar | `features/notes/components/trash-page/`, `store/trash.store.ts`, `NotesApi` (trash methods) | `TrashStore` (items, selected; load, select, restore, purge, empty) |
| auth | Login and register page (one component, `?returnUrl=`, "keep me signed in" checkbox), AuthStore (user + access token in memory, single-flight refresh, restore session at start-up), HTTP interceptor (Bearer + refresh on 401), route guards, sign-out in the sidebar | `src/app/features/auth/` (`auth.interceptor.ts`, `auth.guards.ts`, `safe-return-url.ts`, `store/auth.store.ts`, `services/auth-api.service.ts`, `components/auth-page/`), `core/page-navigation.ts` (`HARD_NAVIGATE`) | `AuthStore`, `AuthApi` |
| sync | Dexie + sync queue | _(not created)_ | |

## Database

| Table | Owning module | Notes |
|---|---|---|
| `notes` (id uuid, title, content, created_at, updated_at, version, is_deleted, notebook_id, is_pinned, status text) | Notes | Soft delete via query filter; `version` is a concurrency token; `notebook_id` FK `ON DELETE SET NULL`; migrations `InitialCreate`, `AddNotebooksTagsAndPinning`, `AddNoteStatus` |
| `note_tags` (note_id, tag_id; composite PK) | Notes | Join table n-n; both FKs cascade |
| `notebooks` (id, name, parent_id, created_at, updated_at) | Notebooks | Self-FK `ParentId` (`RESTRICT`); hard delete |
| `tags` (id, name, normalized_name unique, created_at) | Tags | Unique index on `normalized_name`; hard delete |
| `users` (+ `user_claims`, `user_logins`, `user_tokens`: Identity) | Auth | Guid id, email, password HASH, lockout counters |
| `refresh_tokens` (id, user_id, family_id, token_hash unique, is_persistent, created_at, expires_at, revoked_at, revoked_by_rotation) | Auth | Only the SHA-256 hash of the token is stored; FK to users (cascade) |
| `notes`, `notebooks`, `tags` also have `user_id` (nullable only for pre-auth rows) | each module | FK to users (cascade); tag names unique per user; filtered by the current user in `AppDbContext` |
| `notes.search_vector` (generated tsvector, GIN `ix_notes_search_vector`) and trigram indexes `ix_notes_title_trgm`, `ix_notes_content_trgm` | Notes | Extensions `unaccent`, `pg_trgm`; function `f_unaccent(text)`; the indexes on expressions exist only in the migration |
| Attachment, NoteRevision | _(not created)_ | see PLAN.md §4 |

## Key entry points

- `global.json` – pins .NET SDK 9.0.x
- `.config/dotnet-tools.json` – local tool manifest (`dotnet-ef` 9.x); run EF commands as `dotnet dotnet-ef ...`
- `docker-compose.yml` – local PostgreSQL 17 (`db`, host port **5433** because a Windows PostgreSQL service owns 5432, volume `inknote-db-data`)
- `src/backend/InkNote.sln` – solution; `src/backend/InkNote.Api/` – web API project; `src/backend/InkNote.Api.Tests/` – xUnit tests
- `src/backend/InkNote.Api/Program.cs` – DI registration, DbContext, ProblemDetails, CORS, pipeline, `GET /api/health`; `Http/BadRequestExceptionHandler.cs` turns unreadable request bodies (bad JSON, unknown enum name) into 400
- `src/backend/InkNote.Api/Persistence/AppDbContext.cs` – single shared DbContext (an `IdentityUserContext`); it holds the per-user query filters and `TrashedNotes`; `Persistence/LegacyDataAdopter.cs` gives pre-auth rows to the first account; `Persistence/Migrations/` – EF migrations
- Secrets (not in repo): `ConnectionStrings:Default` and **`Jwt:Key`** (>= 32 chars, signs access tokens) via `dotnet user-secrets` in `InkNote.Api`; production: environment variables `ConnectionStrings__Default`, `Jwt__Key`. Other settings: `Jwt:Issuer/Audience/AccessTokenLifetime/RefreshTokenLifetime (remember me, 30 days)/SessionRefreshTokenLifetime (not remembered, 12 h)/ClockSkew/RefreshReuseGrace`, `RateLimiting:AuthPerMinute` (default 20)
- API docs: Swagger UI `/swagger`, OpenAPI JSON `/openapi/v1.json` (Development only); API docs UI (Swagger UI): `/swagger`, OpenAPI JSON: `/openapi/v1.json` (Development only)
- `src/backend/InkNote.Api.Tests/ApiFixture.cs` – Testcontainers PostgreSQL + in-memory API; `CreateUserClient()` registers a new user and signs in; `NotesApiTests.cs`, `NotebooksApiTests.cs`, `TagsApiTests.cs`, `NoteOrganizationApiTests.cs`, `TrashApiTests.cs` – endpoint tests; `AuthApiTests.cs`, `AuthSecurityTests.cs` (token expiry, refresh-token theft, rate limit, legacy data), `UserIsolationApiTests.cs` (two users, plus every data route without a token) – Phase 5
- While the API is running locally, use `--configuration Release` for `dotnet test` / `dotnet dotnet-ef` (Debug output is locked)
- `src/backend/InkNote.Api/appsettings.Development.json` – `Cors:AllowedOrigins` (Angular dev server)
- API dev URL: `http://localhost:5032` (see `Properties/launchSettings.json`)
- `src/frontend/` – Angular 22 workspace (standalone, SCSS, Vitest, no SSR); dev URL `http://localhost:4200`
- `src/frontend/src/app/app.config.ts` – providers: router (with input binding), `provideHttpClient(withInterceptors([authInterceptor]))`, `provideUi()`, an app initializer that restores the session (`AuthStore.restoreSession`). Routes: `/login`, `/register` (guestGuard), `/notes` (authGuard)
- `src/frontend/src/app/core/ui.providers.ts` – `provideUi()`: ng-zorro locale, registered icons (add new icons here), no-animation; also used by component tests. `NzModalService` and `NzContextMenuService` are provided in `notes.routes.ts` (lazy), so a test of a component that opens dialogs/menus must provide them
- `NotesPageComponent` loads `OrganizationStore` and applies the URL filter (`notebook`/`tag` inputs); the editor only READS `OrganizationStore` (its tests use `http.verify()`)
- Editor `title`/`content` reset only when the saved text changes (`savedText` computed, keyed by id/title/content/updatedAt), so pin/notebook/tag changes never overwrite an unsaved draft
- `src/frontend/src/app/app.routes.ts` – `/` → `/notes`; `notes` lazy-loads `features/notes/notes.routes.ts`
- `src/frontend/src/app/app.ts|html` – shell: only a `<router-outlet>` (the app name lives in the sidebar; toasts/confirm dialogs come from `NzMessageService`/`NzModalService`, no global component)
- `src/frontend/src/app/core/api.config.ts` – API base URL (`http://localhost:5032`)
- `src/frontend/src/styles.scss` + `src/styles/_tokens.scss` (design tokens `--ink-*` for the 3 themes, the only place with raw colors; define every new token in all three) + `_base.scss` + `_markdown.scss` (preview styles, global; one color: `--ink-preview-text`) + `_zorro-overrides.scss` (ng-zorro components restyled with the tokens); `katex/dist/katex.min.css` is added in `angular.json` (**restart `ng serve` after changing `angular.json`**)
- Themes: `src/frontend/src/app/core/theme.service.ts` (`ThemeService`: `theme` signal, `set()`, saves to `localStorage` key `inknote.theme`, sets `<html data-theme>`, swaps the ng-zorro stylesheet) + the script in `src/frontend/src/index.html` (same job before Angular starts; keep in sync). ng-zorro's dark and light builds are copied as assets to `/themes/` by `angular.json`. Theme picker: palette button in the sidebar header. CodeMirror colors: `features/notes/components/markdown-editor/ink-editor-theme.ts`; code blocks: `markdown/highlighter.ts` (Shiki CSS-variables theme); diagrams: `markdown/mermaid-runner.ts` (takes the theme name)
- `src/frontend/src/test-setup.ts` – test-only patches for jsdom (layout APIs CodeMirror needs); registered as `setupFiles` in `angular.json`
- `package.json` `overrides.katex` – forces a single patched KaTeX (0.19.1) for `rehype-katex`/`remark-math` (older nested copies had an advisory)
- Frontend stack: `ng-zorro-antd` 22 (MIT), `@angular/cdk`, `@ngrx/signals` (Phase 2); `codemirror` 6 + `@codemirror/*`, `unified`/`remark-*`/`rehype-*`, `katex`, `shiki`, `@shikijs/rehype`, `dompurify`, `mermaid` (Phase 3), `@codemirror/language` + `@lezer/highlight` (MIT, editor colors). Three themes: Light, Dark (Nord), Warm (Kanagawa Lotus).
