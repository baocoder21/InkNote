# LEARNING NOTES

Short notes for each completed phase: the concept, why it is used in InkNote, and how to verify it works. Added after each phase (see "Learning mode" in CLAUDE.md).

## Phase 0 - Environment and project skeleton

**Concepts**
- **Git / .gitignore**: history of changes; `.gitignore` keeps build output (`bin/`, `obj/`, `node_modules/`) and secrets out of it.
- **global.json**: pins the .NET SDK so every machine/CI builds with the same version (machine has SDK 8 and 9).
- **Solution vs project (.NET)**: `.sln` groups projects; `.csproj` is one buildable unit (`InkNote.Api`).
- **Minimal API**: endpoints declared as `app.MapGet(path, handler)` in `Program.cs`, no controller classes.
- **DI container**: `builder.Services.Add...` registers services; the pipeline (`app.Use...`) order matters.
- **CORS**: the browser blocks cross-origin calls (different port = different origin) unless the API allows the origin. Allowed origins come from configuration.
- **Angular standalone + Signals**: components import what they need directly; `toSignal` turns an Observable into a Signal; `@switch` renders loading/ok/error.
- **HttpClient + service**: components `inject()` a service; HTTP is registered once with `provideHttpClient()`.
- **Docker Compose + volume + healthcheck**: reproducible local PostgreSQL whose data survives container restarts.

**How to verify**
1. `docker compose up -d` (Docker Desktop must be running), then `docker compose ps` shows `inknote-db` as healthy.
2. `dotnet run --project src/backend/InkNote.Api --launch-profile http` and open `http://localhost:5032/api/health`.
3. In `src/frontend`: `npm start`, open `http://localhost:4200` and see "API OK".
4. Stop the API and reload the page: you should see the error message (proves the error branch works).
5. `ng test --watch=false` in `src/frontend` passes.

**Key takeaways**
- A frontend/backend connection fails most often because of CORS or a wrong port, not because of code bugs.
- Keep configuration (origins, connection strings) out of code.

## Phase 1 - Backend: Notes CRUD API on PostgreSQL

**Concepts**
- **ORM / EF Core + Npgsql**: C# classes are mapped to tables; EF generates the SQL. `AppDbContext` is one database session; `db.Notes` is the `notes` table. Mapping lives in `NoteConfiguration` (`IEntityTypeConfiguration`).
- **Migrations**: schema changes as code. `migrations add <Name>` diffs the model against the last snapshot; `database update` applies pending ones. Never edit the DB by hand.
- **Layers inside a module** (`Modules/Notes/`): `Api` (HTTP only) -> `Application` (use cases, DTOs, validators) -> `Domain` (entity rules) ; `Infrastructure` (EF mapping). Endpoints stay thin and call `NoteService`.
- **DTOs**: separate request/response records so clients cannot set fields like `Id` or `Version`.
- **Validation (FluentValidation)**: rules in validator classes; failures become a 400 `ValidationProblem`.
- **ProblemDetails (RFC 9457)**: one JSON shape for errors (400/404/409/500).
- **Dependency injection lifetimes**: `AddScoped<NoteService>` = one instance per HTTP request; `AddDbContext` is scoped too; `TimeProvider` is a singleton clock (fakeable in tests).
- **Soft delete + query filter**: `HasQueryFilter(n => !n.IsDeleted)` hides deleted rows from every query; `IgnoreQueryFilters()` bypasses it (used in a test).
- **Optimistic concurrency**: `Version` is a concurrency token. Update carries the last seen version; mismatch -> 409. EF adds `WHERE version = @old` so a race also fails safely.
- **Guid v7 ids made by the app**: needed later so offline clients can create notes without ID clashes.
- **Testcontainers + WebApplicationFactory**: tests start a throwaway real PostgreSQL and the whole API in memory, apply real migrations, and call HTTP endpoints.
- **user-secrets**: per-developer config stored outside the repo (in your Windows profile), loaded automatically in Development.

**Set up on a new machine**
1. `docker compose up -d` (PostgreSQL on host port **5433**).
2. `cd src/backend/InkNote.Api`
3. `dotnet user-secrets set "ConnectionStrings:Default" "Host=localhost;Port=5433;Database=inknote;Username=inknote;Password=inknote_dev"`
4. `dotnet tool restore` then `dotnet dotnet-ef database update`

**How to verify**
1. `dotnet run --launch-profile http` in `src/backend/InkNote.Api`, then open `http://localhost:5032/swagger` (Swagger UI) and try the endpoints (create -> list -> get -> update -> delete).
2. Send an update with an old `version` and expect **409**; send an empty title and expect **400**.
3. In psql: `docker exec inknote-db psql -U inknote -d inknote -c "select title, version, is_deleted from notes"` shows deleted notes still stored with `is_deleted = t`.
4. `dotnet test` in `src/backend` -> all tests pass (Docker Desktop must be running).

**Pitfalls we hit (worth remembering)**
- A local PostgreSQL service owned port 5432, so the app silently talked to the *wrong* database (error: password authentication failed). Check with `Get-NetTCPConnection -LocalPort 5432`. Fix used: map the container to host port 5433.
- `dotnet ef ... --no-build` after adding a migration uses the *old* assembly and reports "up to date" while doing nothing. Only use `--no-build` when nothing changed.
- A running `dotnet run` locks `bin/`; stop it before building or running migrations.
- EF Core version mismatch between API and test project (9.0.1 vs 9.0.22): reference the EF packages directly with one pinned version.
- EF Core 10 needs .NET 10, so packages are pinned to 9.x.

**Key takeaways**
- Keep endpoints thin; put rules in the domain/application layer.
- Design for the future cheaply: `Guid` ids, `Version`, and soft delete are what make Phase 7 (sync) possible.
- Test against the real database engine; it catches mapping and migration mistakes that mocks hide.

## Phase 2 - Frontend: notes UI with Angular + ng-zorro

**Concepts**
- **ng-zorro-antd** (Ant Design for Angular, MIT): `button[nz-button]`, `nz-input` on `<input>`/`<textarea>`, `nz-alert` (conflict banner), `nz-spin`, `nz-icon`. Toasts and confirm dialogs are *services* (`NzMessageService.success(...)`, `NzModalService.confirm({...})`), not components you place in a template.
- **ng-zorro setup**: its stylesheet goes in `angular.json`; icons are registered one by one (`provideNzIcons([...])`, tree-shaken) - when you use a new `<nz-icon nzType="x">`, add the icon in `core/ui.providers.ts`; `provideNzNoAnimation()` because we do not install `@angular/animations`.
- **Design tokens**: ng-zorro exposes CSS variables only for primary/warning/etc. colors, so neutral colors live in our own `src/styles/_tokens.scss` as `--ink-*`. Components use `var(--ink-...)` and never hardcode a color.
- **Layers**: `NotesApi` (HTTP only) -> `NotesStore` (state + UI rules) -> components (display). Same idea as endpoint -> service -> domain in the backend.
- **NgRx SignalStore**: `withState` (data), `withComputed` (derived values like `count`), `withMethods` (actions). Components read signals (`store.notes()`) and call methods; they never keep server data themselves. State is changed only with `patchState`.
- **Container vs presentational components**: `NotesPageComponent` (container) uses the store and owns the layout. `NotesListComponent` (presentational) only has `input()`s, so it is simple to test and reuse.
- **Lazy + nested routes**: `/notes` code is downloaded on demand (`loadChildren`). The page has a `<router-outlet>`; `/notes/:id` renders the editor inside it.
- **Router input binding** (`withComponentInputBinding()`): the `:id` URL parameter arrives as `readonly id = input.required<string>()`.
- **`effect` + `untracked`**: the editor reloads when `id` changes; `untracked` makes sure only `id` triggers it.
- **`linkedSignal`**: the text being typed is a writable signal that resets to the server value whenever `store.selected()` changes. `isDirty` / `canSave` are `computed` from it.
- **Race condition guard**: `loadNote` remembers the latest requested id and ignores late responses of older requests (tested).
- **Optimistic concurrency in the UI**: saving sends the version we loaded; a 409 shows a warning banner and keeps the user's text; "Reload" fetches the latest version.
- **Signals + `[(ngModel)]`**: a writable signal can be two-way bound directly (`[(ngModel)]="title"`).

**How to verify**
1. Docker Desktop running, then `docker compose up -d`.
2. Terminal A: `dotnet run --launch-profile http` in `src/backend/InkNote.Api`.
3. Terminal B: `npm start` in `src/frontend`, open `http://localhost:4200` (redirects to `/notes`).
4. Click **New note** -> edit title/text -> **Save** (or Ctrl+S) -> the list updates and the note moves to the top. Reload the browser page: the data is still there (it comes from PostgreSQL).
5. Delete a note (confirm modal). Open `/notes/<random-guid>`: you get a "Note not found" message and are redirected.
6. Conflict: open the same note in two browser tabs, save in tab 1, then save in tab 2 -> warning banner with **Reload**.
7. `ng test --watch=false` in `src/frontend` -> 13 tests pass.

**Pitfalls we hit (worth remembering)**
- **License terms matter, not only version compatibility.** We first used PrimeNG 22 (checked only its Angular peer dependency). In the browser it showed a red "Invalid PrimeUI License" badge: PrimeNG 22 needs a license key (free Community tier, but registration required) and its license forbids removing the check. We switched to ng-zorro (MIT). Before adopting a library, read its LICENSE and check the npm `license` field, and look at it in a real browser early.
- A service that is not `providedIn: 'root'` must be provided by us: with PrimeNG `MessageService` (caught by unit tests: `NG0201 No provider found`, `ng build` does not catch it); with ng-zorro `NzModalService`. Always read the real error/type definition, not an assumption from a quick grep.
- A test that awaits only `fixture.whenStable()` can check the DOM too early when the code under test uses several `await`s in a row. The editor spec waits one macrotask (`setTimeout`) in its `settle()` helper.
- Browsers send a **CORS preflight** (OPTIONS) before `PUT`/`DELETE`/JSON `POST`. Verified the API answers 204 with the right `Access-Control-Allow-*` headers.
- ng-zorro ships one 571 kB CSS file (~52 kB gzip), so the initial bundle is ~1.08 MB raw (~186 kB transferred). The Angular size budget (warning 1.2 MB, error 1.5 MB) was raised on purpose instead of being disabled.
- The IDE may underline `imports: [...]` of ng-zorro components ("could not be determined statically") while `ng build` succeeds: trust the compiler.
- Light theme only for now. A dark mode would need ng-zorro's separate dark stylesheet plus a theme switch (possible later).

**Key takeaways**
- Keep server data in one store; components stay thin and easy to test.
- Passing unit tests with a fake API do not prove the real app works: check the real pieces too (here: CORS preflight against the running API).
- Small details of a UX flow (loading state, conflict banner, redirect on 404) are most of the work in a CRUD screen.

## Phase 3 - Markdown editor and live preview

**Concepts**
- **CodeMirror 6**: an `EditorView` holds its own state (document, cursor, undo history) and is configured with a list of *extensions* (`basicSetup`, `markdown()`, line wrapping, placeholder...). `MarkdownEditorComponent` wraps it and keeps it in sync with a `model()` signal: typing -> `updateListener` -> `value.set()`; outside change -> `effect` -> `view.dispatch()` (skipped when the text is already equal, to avoid loops). The view is created in `afterNextRender` because it needs a real DOM element, and destroyed with `DestroyRef`.
- **unified pipeline (remark -> rehype)**: `remark-parse` builds a Markdown tree; `remark-gfm` (tables, task lists, strikethrough) and `remark-math` add syntax; `remark-rehype` converts to an HTML tree; `rehype-katex` renders math; Shiki colors code; `rehype-stringify` writes the HTML string. Each step is a small plugin. Our own plugin `rehypeMermaidBlocks` turns ```` ```mermaid ```` fences into `<pre class="mermaid">` placeholders (it must run before the code highlighter).
- **XSS and defense in depth**: a note may contain `<script>`, `<img onerror=...>`, `javascript:` links. Layer 1: remark-rehype drops raw HTML. Layer 2: DOMPurify cleans the final HTML (we verified each layer separately). Links are forced to `target="_blank" rel="noopener noreferrer"`.
- **Why `innerHTML` is set by hand**: Angular's own sanitizer strips the inline `style` attributes that KaTeX and Shiki depend on. So `MarkdownPreviewComponent` writes `element.innerHTML` itself, using only the already-sanitized output. It is the single allowed place (rule in `.claude/rules/frontend.md`). Styles for that HTML are global (`_markdown.scss`) because inserted HTML has no Angular style attributes.
- **Shiki**: a `createHighlighterCore` with an explicit list of languages (lazy `import()`s) and the JavaScript regex engine (no WASM). Unknown languages fall back to plain text.
- **Mermaid**: huge, so it is `import()`ed only when the preview contains a diagram; `securityLevel: 'strict'`; syntax errors show Mermaid's error picture instead of throwing.
- **Debounce with RxJS**: the preview waits 150 ms after typing, and `switchMap` drops the result of an outdated render. Autosave waits 1.5 s (`debounceTime`), `exhaustMap` prevents overlapping saves, and a `filter` blocks it while there is a version conflict.
- **No lost typing**: the draft is saved (a) by autosave, (b) before switching to another note, (c) when the editor is destroyed, and (d) the browser warns on closing the tab with unsaved changes (`beforeunload`). For (b) `createNote()` does not select the new note, so the editor still has the old draft when it starts switching.
- **Testability**: the autosave delay is an `InjectionToken` that tests shorten. XSS cases are a table of attack strings tested one by one.

**Set up / how to verify**
1. Docker Desktop running; API running (`dotnet run --launch-profile http` in `src/backend/InkNote.Api`); `npm start` in `src/frontend`; open `http://localhost:4200`.
2. Open a note and paste this in the editor:
   ````
   # Demo
   Inline math $E = mc^2$ and a block:

   $$\int_0^1 x^2\,dx = \frac13$$

   | a | b |
   |---|---|
   | 1 | 2 |

   - [x] done
   - [ ] todo

   ```ts
   const answer: number = 42;
   ```

   ```mermaid
   graph TD; A[Write]-->B[Preview];
   ```
   ````
   You should see formulas, a table, checkboxes, colored code and a diagram in the preview.
3. Switch **Edit / Split / Preview**. In Edit mode the preview is not rendered; switching back keeps your cursor.
4. Type, then stop: after ~1.5 s the footer goes from "Unsaved changes" to "Saving..." to "All changes saved" with no click on Save.
5. Type something and immediately click another note: go back to the first one, your text is there.
6. Security check: type `<img src=x onerror=alert(1)>` and `[click](javascript:alert(1))`: no alert, no image, the link has no target.
7. `ng test --watch=false` in `src/frontend` -> 42 tests pass (incl. 19 renderer tests with 11 XSS attack cases).

**Pitfalls we hit (worth remembering)**
- `rehype-katex` does not accept `throwOnError`; it already turns bad formulas into a red `katex-error` block.
- `npm audit` reported an old KaTeX copy nested in `rehype-katex`/`remark-math`. `npm audit fix --force` would have *downgraded* rehype-katex; the clean fix was `overrides: { "katex": "$katex" }` in `package.json`, verified by the math tests.
- jsdom has no layout engine: CodeMirror calls `Range.getClientRects`, so `src/test-setup.ts` adds empty versions (tests only).
- Fake timers (`vi.useFakeTimers`) did not drive RxJS `debounceTime` here. Instead of fighting it, the delay became an injectable token and the test waits for real, with wide margins.
- A short delay chosen for autosave tests made *other* tests flaky (typing + checking took longer than the delay and autosave kicked in). Tests that are not about timing should use a delay that never fires.
- Rendering is slow the first time (Shiki loads grammars); tests warm it up in `beforeAll` with a long timeout.
- The first production build took minutes (cold cache, Mermaid + CodeMirror language data create ~290 files); later builds take ~25 s. CommonJS packages inside Mermaid produce warnings; they are listed in `allowedCommonJsDependencies`.
- Math syntax: `$5 and $6` is read as a formula (a known remark-math trait). Escape the dollar sign (`\$5`) in notes.

**Not done yet (on purpose)**
- Scroll sync between editor and preview; dark theme; persisting the chosen view mode; offline drafts (Phase 7 solves the "close the browser within 1.5 s" gap).

**Key takeaways**
- Treat user content as hostile: sanitize at the *end* of the pipeline, in more than one layer, and write a test for each attack.
- A library is only worth it if you understand what it adds to the bundle and the risk: lazy-load the heavy ones (Mermaid, Shiki grammars).
- Make time injectable; tests that sleep on a constant are fragile.
- What the user types must never be lost: think about every way a draft can disappear (switch note, navigate, close tab).
