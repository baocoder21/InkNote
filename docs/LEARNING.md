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
4. Click **New note** -> edit title/text -> **Save** (or Ctrl+S) -> the list updates and the note moves to the top. (Phase 4's redesign removed the Save button: notes autosave, Ctrl+S still works.) Reload the browser page: the data is still there (it comes from PostgreSQL).
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
- The app was light-only in Phases 2-3; it now has three themes (see "Phase 4 themes" below).

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
- **Debounce with RxJS**: the preview waits 50 ms after typing (`PREVIEW_DELAY_MS`; it was 150 ms until we measured, see "Preview latency" below), and `switchMap` drops the result of an outdated render. Autosave waits 1.5 s (`debounceTime`), `exhaustMap` prevents overlapping saves, and a `filter` blocks it while there is a version conflict.
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
- **Preview latency**: typed text appeared in the preview "a bit late". Measured render time (jsdom, one changed note per run): 30 paragraphs 15 ms, 5 code blocks 23 ms, table 9 ms, **20 formulas 63 ms** (KaTeX ~3 ms each), everything together ~117 ms. So the fixed 150 ms debounce was most of the delay for ordinary notes. Fixes: debounce 150 -> 50 ms, and a **Mermaid cache** (`mermaid-runner.ts`): the preview replaces its whole HTML after each pause, which used to redraw every diagram each time. Now a diagram whose source did not change is put back synchronously from cached DOM nodes (cloned, never an HTML string, so the "innerHTML only in the preview" rule holds); failed diagrams are not cached. Still open if it is not enough: KaTeX results could be cached per formula, or the DOM updated block by block instead of replaced. Measure before doing either. Note `ng serve` (development build) is slower than the production build.

**Not done yet (on purpose)**
- Scroll sync between editor and preview; dark theme; persisting the chosen view mode; offline drafts (Phase 7 solves the "close the browser within 1.5 s" gap).

**Key takeaways**
- Treat user content as hostile: sanitize at the *end* of the pipeline, in more than one layer, and write a test for each attack.
- A library is only worth it if you understand what it adds to the bundle and the risk: lazy-load the heavy ones (Mermaid, Shiki grammars).
- Make time injectable; tests that sleep on a constant are fragile.
- What the user types must never be lost: think about every way a draft can disappear (switch note, navigate, close tab).

## Phase 4 - Notebooks and tags

**Concepts**
- **One-to-many (1-n)**: one notebook has many notes. In SQL it is a *foreign key* column on the "many" side (`notes.notebook_id` -> `notebooks.id`). `NotebookId` is nullable: a note may live in no notebook. `ON DELETE SET NULL` says what the database does with notes if their notebook row is deleted.
- **Many-to-many (n-n)**: a note has many tags and a tag labels many notes. SQL cannot put that in one column, so a **join table** `note_tags(note_id, tag_id)` holds one row per pair. Its primary key is the pair, so the same tag cannot be attached twice. In EF Core it is the `NoteTag` entity; `Note.Tags` is a read-only list backed by a private field, and `SetOrganization()` is the only way to change it.
- **Tree with `ParentId`**: a notebook points to its parent (a foreign key to its own table; `NULL` = top level). The API returns a flat list and the client builds the tree. Danger: **cycles**. Before moving notebook A under B, walk up from B through the parents; if you meet A, B is A or one of A's descendants, and the move is refused.
- **Modules linked only by Ids and contracts**: Notes must reference notebooks and tags, but modules may not touch each other's entities. So Note holds plain Guids, and a module asks another through a tiny interface (`INotebookLookup.ExistsAsync`, `ITagLookup.CountExistingAsync`, `INotebookUsage.HasNotesAsync`). The database still enforces integrity with foreign keys.
- **Resource-oriented API design**: `/api/notebooks`, `/api/tags`, and `PUT /api/notes/{id}/organization` as a sub-resource of a note. Why a separate endpoint? The editor autosaves the title and content every 1.5 s; if the same request also carried notebook/tags, an autosave could overwrite a tag change made a moment ago.
- **Status codes as part of the design**: 400 = the request is invalid (unknown parent id, a cycle), 404 = the thing is not there, 409 = valid request, but the current state forbids it (deleting a non-empty notebook, a duplicate tag name, a stale version).
- **Unique names ignoring case**: tags keep a `NormalizedName` (trimmed, upper-case) with a *unique index*. The service checks first (to return a friendly 409), and the index is the real guarantee when two requests race: we catch PostgreSQL's unique-violation error (`23505`) and also answer 409.
- **Filtering through a relation**: `n.Tags.Any(t => t.TagId == tag)` becomes `WHERE EXISTS (SELECT 1 FROM note_tags ...)`. The index on `note_tags.tag_id` makes it fast.

**How to verify**
1. Backend tests: from `src/backend`, `dotnet test --configuration Release` -> 31 tests pass (8 old + 23 new: cycles, 409s, tag set replacement, filters, pin order, FK behaviour with soft-deleted notes).
2. In Swagger UI (`/swagger`): create a notebook, create a sub-notebook, try to move the parent into the child (400), create a tag twice (second is 409), `PUT /api/notes/{id}/organization`, then `GET /api/notes?tagId=...`.
3. Look at the tables in the database: `notebooks`, `tags`, `note_tags` and the new `notes` columns (`notebook_id`, `is_pinned`).

**Pitfalls we hit**
- A running API locks `bin/Debug`, so `dotnet test` / `dotnet ef` failed to copy files. Fix without stopping the API: `--configuration Release` writes to `bin/Release`.
- PostgreSQL timestamps keep **microseconds**, .NET keeps 100-nanosecond ticks. A date read straight after `Create()` differs in the last digit from the same date read back from the database. Compare values that both came from the database.
- `UpdateAsync` returns the note including its tag ids, so it must `Include(n => n.Tags)`; without it the response would claim the note has no tags even though the data is fine.

**Frontend concepts**
- **URL as state**: the tag filter is `/notes?tag=<id>`, not a hidden variable. Reload, a shared link and the Back button all work for free. With `withComponentInputBinding()` Angular copies query parameters into `input()`s of the same name, so `NotesPageComponent` just declares `tag = input<string>()`. Links that must not lose the filter use `queryParamsHandling="preserve"`. (The first version also filtered by notebook through the URL and the server; the redesign replaced that with the tree, see below.)
- **Tree from a flat list**: `buildNotebookTree` groups notebooks by parent and hangs each group under its parent. It is a pure function, so it has its own tiny tests.
- **Merge, do not replace** (the important bug we prevented): the server answers an organization update with the whole note, including the last *saved* text. Replacing `selected` with it would reset the editor's `linkedSignal`s and **erase an unsaved draft**. So the store merges only the organization fields, and the editor derives its reset from a `computed` with a custom `equal` (`savedText`) that ignores version/notebook/pin/tag changes. `updatedAt` is in the comparison key on purpose: a content save always changes it, while an organization change does not (backend decision).
- **We proved the test matters**: with the fix disabled the test "pins the note without touching the unsaved draft" fails (`expected 'Hello' to be 'Draft not saved yet'`). A regression test that has never failed proves nothing.
- **Container / presentational again**: `NotesSidebarComponent` (talks to the store, dialogs, messages) vs `NotebookTreeComponent` and `NoteOrganizationComponent` (inputs and outputs only). The organization component emits the COMPLETE new state and never saves; the editor decides.
- **A dialog is a component**: `NameDialogComponent` receives its data through `NZ_MODAL_DATA` and closes itself with `NzModalRef.close(value)`; the sidebar wraps it in `askName()` returning a Promise.

**Frontend: how to verify**
1. Restart the API (new endpoints), `npm start`, open `http://localhost:4200/notes`.
2. Sidebar: create a notebook (+ next to Notebooks), then a sub-notebook (hover the notebook, + icon). Rename and delete work from the hover icons; deleting a non-empty notebook shows a warning (409).
3. Create a tag (+ next to Tags). Create it again with different case: "already exists".
4. Open a note: pin it (pushpin), choose a notebook, add tags. Type some text, then pin it WITHOUT waiting: your text must stay.
5. Click a tag in the sidebar: the tree is replaced by the notes with that tag and the URL shows `?tag=`. Reload the page: the filter is still there. Open a note: the filter stays. Pinned notes are first inside their folder.
6. `ng test --watch=false` -> 103 tests pass (after the redesign below).

**Frontend pitfalls**
- The editor's tests call `http.verify()`, so the editor must not trigger HTTP on its own (it only reads `OrganizationStore`; the page loads it).
- A dialog opened with `NzModalService` lives in an overlay outside the component, and its result arrives asynchronously: tests wait with `vi.waitFor(...)` instead of guessing a delay.
- The initial bundle reached 1.18 MB at this point (budget warning at 1.2 MB); the redesign below brought it down.

**Key takeaways**
- Relations are decisions about *who owns the data* and *what happens on delete* (`SET NULL`, `CASCADE`, `RESTRICT`), not just joins.
- Let the database enforce rules that must never break (foreign keys, unique index) and keep friendly checks in the service on top.
- Give frequently-changing and rarely-changing fields different endpoints so they cannot overwrite each other.

## Phase 4 redesign - one explorer-style sidebar and a dark theme

The user asked for: no Save button and no trash icon, ONE sidebar to create notes and folders (with real icons instead of "+"), and a look inspired by Inkdrop. Chosen: an explorer-style tree (folders contain notes) and a fully dark theme.

**Concepts**
- **A tree as a flat list of rows** (`explorer-rows.ts`): `buildExplorerRows(tree, notes, expanded)` returns the lines currently visible, each with its depth; the template is one `@for` and the indentation is a padding. Simpler than recursion and it is how editors draw file explorers. Pure function, tested without any component.
- **The client groups, the server stores**: a tree with notes inside needs every note, so the sidebar loads the whole list once (titles only) and groups, sorts and filters it in the browser. Sorting inside a folder is by title, not by last edit, because autosave changes the date while you type and the note would jump away.
- **Menus instead of buttons**: right-click (and a hover "..." button, so it also works without a mouse) opens ONE shared `nz-dropdown-menu`; a `target` signal says which row it belongs to. `NzContextMenuService.create(event, menu)` opens it at the pointer. Rows stay clean; the actions are still discoverable.
- **Theming**: ng-zorro's dark stylesheet styles its own components; our `--ink-*` tokens style ours; `_zorro-overrides.scss` patches what the stylesheet misses (it has no rules for the "outlined" select, so the pickers stayed white). CodeMirror, Shiki and Mermaid each have their own theme setting. (This first version was dark-only; the three themes below replaced its details.)
- **Providers are lazy too**: `NzModalService` and `NzContextMenuService` moved from the app-wide providers to the notes route. The initial bundle fell from 1.18 MB to 1.00 MB.

**Lessons from testing in a real browser** (the unit tests, run in jsdom, could not see any of these)
- A tool kept outside the project (Playwright driving Chrome against the dev server, with a fake in-memory API so the user's database is untouched) found, in minutes: the KaTeX CSS missing (stale `ng serve`), white selects in a dark page, a missing `NzContextMenuService` provider, and a dialog whose input never got the focus.
- **`ng serve` does not reload `angular.json`.** Changing the `styles` list needs a restart. It happened twice: the user's server missed the KaTeX CSS (formulas showed twice), then my own server ignored the dark stylesheet.
- jsdom has no layout, no focus management of overlays and no real CSS cascade: use it for logic, a real browser for what things look like and for focus.

**Pitfalls**
- A deleted tag id stays in the notes' `tagIds` on the client; the next pin would send it and get 400. `NotesStore.forgetTag()` removes it right after the delete.
- `NzContextMenuService` is not root-provided (same story as `NzModalService`); the error only appears at runtime, in the browser.

**Key takeaways**
- Look at the real thing in a real browser before calling a UI done: tests that pass in jsdom cannot tell you the page is white-on-dark, or that a dialog does not accept typing.
- Pure functions (tree, visible rows, ancestors) keep the interesting logic out of components and make it cheap to test.
- A UI redesign is a good moment to delete what no longer earns its place (here: the server-side filter in the store, the list component); verify what the user asked to remove is really gone (no Save button, no trash icon) with a test.

## Phase 4 themes - Light, Dark and Warm

The user asked for three themes: **Dark = Nord** (background #2e3440, text #d8dee9), **Warm = Kanagawa Lotus** (#f1e9d2 / #4d699b) and **Light** (#edeeec / #dc347f), each with "special character" colors chosen for readability, inspired by Inkdrop.

**Concepts**
- **Design tokens per theme**: every color is a CSS custom property (`--ink-bg`, `--ink-text`, `--ink-accent`, `--ink-syn-mark`...). `_tokens.scss` defines the same names three times, under `:root[data-theme='dark' | 'warm' | 'light']`. Components never change: switching theme = changing one attribute on `<html>`.
- **`ThemeService`** (a signal + `set()`): sets the attribute, saves the choice, swaps ng-zorro's stylesheet. The page changes *before* the signal does, so anything reacting to the signal (Mermaid reads the CSS colors) already sees the new ones.
- **Why a script in `index.html`**: Angular starts after the first paint; without the script the page would show the default theme and then jump to the saved one. The script sets `data-theme` and loads the right ng-zorro stylesheet immediately, with `blocking="render"`. The production build had one more trap: Angular inlines "critical CSS" containing only the default theme's tokens, so `inlineCritical` is switched off.
- **Two stylesheets that cannot coexist**: ng-zorro has a dark build and a light build with the same selectors. They are copied as assets and swapped at run time (new one inserted next to the old one, old one removed on `load`). Order matters: at equal specificity the LATER stylesheet wins, and ours must come after ng-zorro's.
- **CSS variables all the way down**: CodeMirror's `HighlightStyle` takes `var(--ink-syn-keyword)` as a color; Shiki has a "CSS variables" theme (`createCssVariablesTheme`) that writes `color: var(--ink-code-token-keyword)`. So the editor and the code blocks recolor on theme change with no rebuild and no re-render. Mermaid cannot do that (colors are baked into its SVG), so it is re-initialized with its `base` theme fed by the computed colors, and its cache is cleared.
- **Contrast is a number, not a feeling**: WCAG asks 4.5:1 for body text. The ratios of the palette were computed with a small script (text vs background, and each accent/syntax color on the background and on the code background); colors were adjusted until all but the dimmed code comments passed.

**The one thing to know about the Light theme**: the user's text color (#dc347f on #edeeec) is **3.73:1**, below 4.5:1. It was kept as asked; headings, links and code use darker variants. A darker pink such as #b02060 would give ~5.5:1 if reading comfort turns out to matter.

**How to verify**
1. Restart `npm start` (the ng-zorro stylesheets moved from `angular.json` to assets) and open the app: it starts in Dark.
2. Click the palette icon at the right of the sidebar header: Light, Dark, Warm, with a check on the current one. Pick each: the whole app changes at once, including the editor colors, code blocks, the diagram and the dialogs/menus (right-click a note, click "new folder").
3. Reload the page: the chosen theme is still there and there is no flash of another theme.
4. `ng test --watch=false` -> 117 tests pass.

**Pitfalls**
- `NzDropdownDirective` (lowercase "d") is the click-triggered dropdown; the name with a capital "D" does not exist.
- A rule that is not applied is often a specificity or order problem: a `!important` on CodeMirror's selection background and a doubled class on the ng-zorro danger color were needed.
- A new color token must be added to all three theme blocks, or that theme silently falls back to nothing.

**Key takeaways**
- Theming is mostly a naming problem: describe colors by role (`--ink-text-muted`, `--ink-syn-mark`), not by value, and each theme becomes just a table.
- Everything that cannot read CSS variables (a third-party widget with baked-in colors) needs a bridge: here a service that tells it to redraw.
- Check accessibility with numbers (contrast ratios) and tell the user when a requested color falls short, rather than silently "fixing" it.

## Phase 4 editor polish - status, search pickers, live styling

**What changed (user request)**: remove the status line under the editor; show headings/bold/italic/strikethrough in the editor the way the preview shows them; put Edit/Split/Preview in the middle; searchable notebook and tag pickers, a new status picker, a smaller tag picker.

**Concepts**
- **Adding a column end to end**: `NoteStatus` enum (Domain) -> `Note.Status` set through `SetOrganization` -> DTOs -> EF configuration (`HasConversion<string>`, default) -> migration `AddNoteStatus` (an `ADD COLUMN ... DEFAULT 'None'`, so old rows get a value) -> validator -> frontend model -> store -> picker. The same feature crosses every layer; the compiler (C# and TypeScript) lists what you forgot.
- **Enums over JSON**: by default .NET sends an enum as a number, which breaks the moment someone reorders the enum. `JsonStringEnumConverter` sends the name; the database stores the name too. A name the server does not know ("Nonsense") makes JSON binding fail, and that is a client error (400), so a small `IExceptionHandler` maps it. Without it ASP.NET answered 500.
- **Two kinds of styling in CodeMirror**: `HighlightStyle` styles pieces of text (a bold span, a link). A **line decoration** (`Decoration.line({class})`) styles a whole line, which is the only way to make a "# Title" line bigger *including* its `#`. A ViewPlugin walks the syntax tree and builds those decorations; it must rebuild when the text, the viewport OR the parsed tree changes (the parser works in the background).
- **Dialects**: CodeMirror's Markdown default is CommonMark. GitHub's tables, `~~strike~~` and task lists need `base: markdownLanguage`. Symptom of getting it wrong: the preview shows strikethrough but the editor does not even know it exists.
- **Search in a dropdown**: ng-zorro `nz-select` has `nzShowSearch` (single) and searches by default in `multiple` mode; it filters on the option label.

**How to verify**
1. Restart the API (a new migration, `AddNoteStatus`, must be applied first: `dotnet dotnet-ef database update --configuration Release` in `src/backend/InkNote.Api`) and reload the page.
2. Open a note and type `# Title`, `## Sub`, `**bold**`, `*italic*`, `~~gone~~`, a `> quote` and a ```` ``` ```` block: the editor shows them like the preview. Try the three themes.
3. Pickers: the notebook one filters while you type; the tag one too; the status one offers No status / Active / On hold / Completed / Dropped and survives a reload.
4. `dotnet test --configuration Release` -> 33 pass; `ng test --watch=false` -> 128 pass.

**Pitfalls**
- A test that parses Markdown with `ensureSyntaxTree` gets a full tree, but `syntaxTree(state)` is only what was parsed so far; the plugin therefore takes the tree as an optional argument.
- A line decoration cannot override `.cm-line`'s own padding without `!important` (the quote bar).
- The new request field `status` is mandatory on purpose; the three old tests that built the request by position had to change, which is exactly the compiler protecting you.

**Key takeaways**
- A small feature is a vertical slice: schema, API, validation, client, UI and tests all move together.
- "Looks like the preview" is mostly choosing the right granularity: text pieces (HighlightStyle) vs whole lines (decorations).
- When a test fails for a reason you did not expect, ask whether it found a real bug: here it exposed the missing GFM dialect and the 500-instead-of-400.

## Phase 4 - a monochrome preview

**Request**: the preview shows plain "black" text in all three themes; only the editor uses many colors to tell syntax apart.

**Idea**: a new design token `--ink-preview-text` (defined in all three themes) and `.markdown-body` uses only it. Without color, hierarchy comes from size, weight, underline and background boxes.
- Code blocks are colored by Shiki through CSS variables (`--ink-code-token-*`). Variables are inherited, so redefining them *inside* `.markdown-body` makes the preview's code monochrome while any other use keeps the theme colors: **scope an override instead of editing the shared definition**.
- Mermaid bakes colors into its SVG, so its theme variables were switched to the same token.
- "Black" in the dark theme would be invisible (#000 on #2e3440), so Dark uses its light text color; the rule is "the neutral text color of the theme", not literally black.

**Verify**: open a note with headings, bold, a link, a code block and a diagram in each theme (palette button in the sidebar): the right pane is one color, the left pane keeps its colors.

## Phase 4 - sidebar actions, status and tags on each row

**Request**: options right after a click (rename for files and folders; new file / new folder inside a folder), status and tags visible on every note in the sidebar, titles in bold.

**Concepts**
- **Discoverability**: a right-click menu is invisible. Small buttons on the row (shown on hover, on keyboard focus and always on the selected row) make the same actions visible. CSS only: `.row:hover .row__actions`, `.row--active .row__actions`.
- **`stopPropagation` on nested buttons**: a button inside a clickable row would also trigger the row's click (opening the note, expanding the folder). The shared helper `act()` stops that.
- **Data the row does not own**: a note stores tag IDS; the row needs NAMES. The tree gets the tag list as an input and builds an id -> name map with `computed`. Ids of deleted tags are skipped.
- **Rename without a second save path**: the list has no note content, so renaming from the sidebar by PUT would need a GET first and could race with the editor's autosave. Instead the sidebar opens the note and asks the editor (through a field in the store) to focus and select the title; the existing autosave does the rest.
- **Small text needs contrast too**: the 11px status chips were measured (colored text on a 12% tint of itself) and darkened in Light/Warm until all were >= 4.5:1.

**How to verify**: click a folder: new note / new subfolder / rename / "..." appear on its row; click a note: rename and "..." appear; Rename puts the cursor in the title with the text selected, typing and Enter saves it and the sidebar updates; give a note a status and tags in the editor: they appear under its title in the sidebar. `ng test --watch=false` -> 141 pass.

## Phase 4 - the trash (restore and delete forever)

**Why it was cheap**: notes were already *soft-deleted* (`IsDeleted = true`, row kept, hidden by a query filter). The trash is only a way to see and undo that.

**Concepts**
- **Turning a query filter off on purpose**: `IgnoreQueryFilters()` makes EF show the hidden rows again. The rule used here: every trash query also says `Where(n => n.IsDeleted)`, so a typo in an id can never touch a live note. There is a test for exactly that ("the trash endpoints never show or touch a live note").
- **Resource design**: the trash is its own collection, `/api/notes/trash`, with `POST .../restore` for the action that is not a plain CRUD verb. `{id:guid}` on the normal route makes sure "trash" is never read as a note id.
- **`ExecuteDeleteAsync`**: one SQL `DELETE ... WHERE` without loading entities. The foreign key's `ON DELETE CASCADE` removes the note's tag links, which a test checks directly in the database.
- **Soft vs hard, again**: restoring bumps `Version` and `UpdatedAt` (a sync client must notice); deleting for good removes the row, so Phase 7 will need a record that it existed (a tombstone).
- **Which actions deserve a confirmation?** Only the irreversible ones. Moving to the trash and restoring are reversible, so they just show a message.
- **Two stores**: `TrashStore` is separate from `NotesStore` so deleted notes cannot leak into the sidebar; the page that restores a note tells `NotesStore` to reload.

**How to verify**
1. Restart the API (new endpoints). Delete a note from the sidebar: it asks "Move to trash?", disappears, and the **Trash** link at the bottom shows a count.
2. Open Trash: the list on the left, the read-only content on the right. **Restore** puts the note back in its folder with its tags and status; **Delete forever** and **Empty trash** ask first.
3. `dotnet test --configuration Release` -> 41 pass; `ng test --watch=false` -> 158 pass.

## Phase 5 - Authentication (accounts, JWT, refresh tokens, per-user data)

**Goal**: every person sees only their own notes. That needs four things: knowing who is calling (authentication), refusing everyone else (authorization), keeping each person's rows apart, and a front end that lives with all that.

**Concepts**
- **Authentication vs authorization**: "who are you?" (sign in) vs "what may you do?" (here: only touch your own data). A 401 means "I do not know who you are", a 404 on someone else's note means "for you it does not exist".
- **Never store a password**: Identity stores a salted, deliberately slow HASH. Login hashes the typed password and compares. Even an unknown email is hashed, so the response time cannot reveal which emails exist.
- **JWT access token**: `header.payload.signature`, the payload holds claims (`sub` = user id, `exp` = expiry). Anyone can read it, nobody can change it (the signature is made with `Jwt:Key`, which only the server has). The API checks signature, issuer, audience and expiry on every request, so it never asks the database "who is this?". Price: it cannot be revoked, so it lives only 15 minutes.
- **Refresh token**: a random string that only asks for a new access token. Stored as a hash, single use ("rotation"), grouped in a family per sign-in. If an old one shows up again, someone copied it: the whole family is revoked. Racing requests are settled by one `UPDATE ... WHERE revoked_at IS NULL`.
- **Where tokens live in the browser**: localStorage is readable by any script on the page (an XSS bug would leak the token), so the access token stays in memory only, and the refresh token is an `HttpOnly` cookie that scripts cannot read, sent only to `/api/auth`, `SameSite=Lax`. A reload loses the memory, so the app asks `/refresh` once at start-up.
- **Interceptor**: one function every HTTP request passes through. It adds `Authorization: Bearer ...`, and on a 401 renews the token and repeats the request once. Several failing requests share ONE refresh (the token is single use).
- **Route guard**: keeps signed-out visitors out of the pages, with `returnUrl` to come back. It is only comfort; the real protection is the server. `returnUrl` comes from the address bar, so it is accepted only if it is a path inside the app (open-redirect protection).
- **Global query filter**: `HasQueryFilter(x => x.UserId == CurrentUserId)` makes EF add the owner condition to EVERY query on that entity. Forgetting it in one service becomes impossible. Danger: `IgnoreQueryFilters()` drops it too, so the trash goes through `AppDbContext.TrashedNotes`, which has the owner check written next to it.
- **Secure by default**: a fallback authorization policy requires sign-in on every endpoint; open ones are marked `AllowAnonymous()`. A test calls all data endpoints without a token.
- **Rate limiting**: 20 register/login/refresh requests per minute per IP; wrong passwords also lock an account after 5 attempts.

**One-time setup on a new machine** (the signing key is a secret, so it is not in the repository). On this machine it is already set.
```
cd src/backend/InkNote.Api
dotnet user-secrets set "Jwt:Key" "<a long random string, at least 32 characters>"
```
(for example the output of `openssl rand -base64 64`). Without it the API refuses to start and says so.

**How to verify**
1. Stop the running API, then start it again (`dotnet run --launch-profile http` in `src/backend/InkNote.Api`); the migration `AddAuthAndOwnership` is already applied to your database.
2. Open http://localhost:4200: you land on the sign-in page. Choose **Create an account**: the FIRST account adopts the notes that existed before accounts.
3. Reload the page: you stay signed in. Sign out (bottom of the sidebar), create a second account: it sees nothing of the first.
4. In DevTools, Application tab: localStorage has no token; the cookie `inknote_refresh` is HttpOnly.
5. `dotnet test --configuration Release` (96 tests) and `ng test --watch=false` (217 tests).

**Pitfalls**
- Only read configuration lazily (options bound at first use): in tests the settings arrive after `Program.cs` has started.
- Two browser tabs refreshing together send the same single-use token: the server tolerates a short grace period, and the front end retries once.
- Identity's password errors have codes ("PasswordTooShort") that the API groups under the `password` field for the form.
- A test that waits for expiry must warm the server up first, otherwise the first slow request eats the token's short life.

**Key takeaways**
- Security is mostly "make the safe thing the default": sign-in required unless stated, filtering done once in the context, secrets only in secret stores.
- Short-lived + revocable beats long-lived: a stolen access token expires soon, a stolen refresh token is detected when used twice.
- Test the attacks, not just the happy path: forged tokens, other users, replayed refresh tokens, too many attempts.

## Phase 5 addendum - "Keep me signed in" (remember me)

**What it means technically**: a cookie normally lives until the browser closes (a *session cookie*). Adding an expiry date (`Expires`) makes it a *persistent cookie* that survives restarts. "Remember me" is exactly the choice between the two, plus how long the SERVER keeps accepting the token.

**Concepts**
- **Session vs persistent cookie**: no `Expires` = deleted when the browser closes; with `Expires` = kept until that date. The server cannot see the difference when the cookie comes back, so it ALSO stores the choice (`is_persistent`) and gives non-remembered tokens a short server-side life (12 h): a browser that is never closed, or a copied cookie, still stops working.
- **The choice must survive rotation**: every refresh issues a new token. If the new one forgot the choice, a remembered sign-in would silently turn into a session one (or the reverse). The new token inherits `IsPersistent` from the one it replaces.
- **A real EF Core trap**: for a `bool` with `HasDefaultValue(true)`, EF cannot tell "false on purpose" from "not set" (both are `false`), so it leaves the column out of the INSERT and the database writes `true`. The default is therefore only in the MIGRATION (to fill rows that already exist), never in the model. A test stores a not-remembered token and checks its 12-hour lifetime.
- **Safe default**: the box is off. Tick it only on a device that is yours.
- **What it does not change**: the access token stays in memory and lasts 15 minutes whatever you choose; only the refresh cookie differs.

**How to verify**
1. Restart the API (the migration `AddRefreshTokenPersistence` is already applied) and reload the page.
2. Sign in WITHOUT the box: in DevTools, Application, Cookies, `inknote_refresh` shows "Session" as expiry. Close the whole browser and reopen the app: you must sign in again.
3. Sign in WITH the box: the cookie expires in about 30 days; after closing and reopening the browser you are still signed in.
4. `dotnet test --configuration Release` (101 tests), `ng test --watch=false` (220 tests).

## Phase 6 - Full-text search

**Goal**: type a few letters and get the right notes, ranked, with the matching words marked, ignoring case and accents and surviving a small typo.

**Why not `LIKE '%word%'`?** It reads every row (no index can help a pattern that starts with `%`), cannot rank, does not ignore accents and is not typo-tolerant. Measured on 20,000 notes (`EXPLAIN ANALYZE`): the indexed full-text query for a rare word took **0.14 ms**, a sequential scan of the same condition **1305 ms**, `ILIKE '%quokka%'` **253 ms**.

**Concepts**
- **`tsvector`**: a text turned into a sorted list of normalized words with positions. **`tsquery`**: what to look for (`prog:*` = a word starting with "prog"; `a:* & b:*` = both). `@@` asks "does this vector satisfy this query?". The `simple` configuration only lowercases and splits; PostgreSQL has no Vietnamese dictionary (stemming and stop words are for English, French...), but Vietnamese words are separated by spaces, which `simple` handles.
- **Generated column** (`GENERATED ALWAYS AS (...) STORED`): the DATABASE recomputes `search_vector` whenever title or content change, so the index can never be out of date and no application code has to remember it. A test edits a note and checks the old word is gone and the new one found.
- **GIN index** ("generalized inverted index"): word -> rows that contain it, like the index at the back of a book. Look-ups touch only those rows.
- **`unaccent` and why a wrapper function**: `unaccent('đường')` = `duong`. PostgreSQL only allows IMMUTABLE functions in generated columns and indexes, and `unaccent()` is merely STABLE (it depends on a dictionary that could change), so the migration creates `f_unaccent()` declared IMMUTABLE. Always use the SAME function in the index, in the column and in the query; the planner only uses an expression index when the query writes exactly that expression.
- **Trigrams (`pg_trgm`)**: a word is cut into groups of 3 letters; two words are "similar" when they share many groups. `word_similarity('meting', 'weekly meeting notes')` is 0.67, above the 0.6 threshold, so the operator `'meting' <% text` is true. Index support needs the column on the RIGHT side of `<%` (a test of mine had it backwards and the plan showed no index).
- **Match every WORD, judge typos PER WORD**: first version compared the whole phrase for similarity, so a note about "alpha gamma" matched "alpha beta". A test showed it. Now each word is its own condition, chained with AND.
- **Measure, then optimize**: first version took 2-6 s when a word matched most of the table. Causes: the rank formula was computed twice per row, and comparing the query with the whole content is expensive. Fix: cheap rank only in ORDER BY, find the page's ids first, then read the content of just those notes. Now ~0.1 s.
- **Safe by construction**: query words are letters and digits only, so none of the tsquery operator characters (`& | ! ( ) : * '`) can get in, and the text goes to the database as a parameter, never glued into SQL. Tests throw operators, quotes and `'; DROP TABLE notes; --` at it.
- **Highlighting without HTML**: the server cuts title and snippet into `{text, match}` parts, finding matches in the UNACCENTED text and mapping positions back to the original (a map from each normalized character to its original index), so "đường" is marked with its accents. The client draws `<mark>`. No `innerHTML`, so a note containing `<script>` shows it as text.
- **Search state in the URL**: `?q=` like the tag filter; typing is debounced and replaces the history entry. A subtle bug avoided: if the box followed every URL change, a slow navigation could overwrite letters typed in the meantime; it follows only changes this component did not make.

**Honest limits** (measured): one missing/extra letter in longer words works ("meting", "kubernets"); swapped or changed letters in short words do not ("recieve", "budjet"); words under 4 letters match only by their beginning; a query that matches almost every note is slower (the rank must be computed for all of them).

**How to verify**
1. Restart the API (the migration `AddFullTextSearch` is already applied; it also enabled the `unaccent` and `pg_trgm` extensions).
2. Create a few notes ("Ghi chú cuộc họp" with "đường Đồng Khởi" in the body, "Weekly meeting notes"...). Type in the box under the InkNote header: `duong dong khoi`, `meting`, `prog`... Results replace the tree, the words are highlighted, the URL gets `?q=`. Esc or the x brings the tree back; click a result: the note opens and the results stay.
3. In pgAdmin: `EXPLAIN ANALYZE SELECT id FROM notes WHERE search_vector @@ to_tsquery('simple', 'meeting:*')` (add `SET enable_seqscan = off;` first on a small table) and look for `Bitmap Index Scan on ix_notes_search_vector`.
4. `dotnet test --configuration Release` (175 tests), `ng test --watch=false` (258 tests).

**Pitfalls**
- A near-empty table is read sequentially (cheaper than an index): to see the index, forbid it for one check (`enable_seqscan = off`) or test with thousands of rows.
- A lone surrogate (half an emoji) makes `string.Normalize` throw: handle surrogates separately.
- `HasComputedColumnSql` + a function: the function must exist BEFORE the column is added (the migration creates it first).
- EF Core cannot describe expression indexes in the model: they live only in the migration (`migrationBuilder.Sql`).

**Key takeaways**
- Let the database do what it is good at (index, rank, similarity) and keep the application for presentation (snippets, highlight).
- Put the guarantees in the database (a generated column cannot be stale) and prove them with tests.
- Measure with real numbers (`EXPLAIN ANALYZE`, 20,000 rows): the first fast-looking version was 20x slower than it needed to be in the common case, and only measuring showed it.

## Phase 7 - Local-first (IndexedDB, outbox, synchronization)

**Concepts**
- **Local-first**: the screen talks to a database ON THE DEVICE (IndexedDB, through Dexie), never to the network. The server is a replica that the app keeps in step in the background. Result: instant UI, works offline, and "save failed because the network dropped" stops existing.
- **Dexie live queries**: `liveQuery(() => db.notes.toArray())` re-runs when any table it read changes, from any source (the editor, another tab, the sync). `live()` turns it into an Observable, so the stores just subscribe and the screen follows the database by itself.
- **Outbox (sync queue)**: every change is written to the data AND to an `outbox` table in ONE transaction, so they can never disagree. The engine sends the outbox in batches. `attempted` operations (already handed to the network) are frozen, because the server may have applied them: a retry has to be the same operation (same `opId`) so the server recognizes it. Newer edits go into a separate `pending` operation that can still be merged.
- **Idempotency**: sending the same operation twice must not apply it twice. The server stores the result per `(user, opId)` and returns it again.
- **Cursor pull and the settle window**: the client asks "what changed after sequence N?". The sequence is stamped by database triggers. A slow transaction can commit after a faster one that has a higher number, which would let a client skip it forever; so the server only hands out changes older than 2 seconds, and only an uninterrupted prefix of them.
- **Conflict policy**: stale base version AND a different title/text: the server text is saved as a `NoteRevision` and the newer write wins. Different fields (pin vs text) merge. Nothing is silently lost.
- **Patches**: an operation sends only the fields that changed (absent = unchanged, `null` = clear), which is what makes merging possible at all.

**Why it is built this way**
- Client-made GUIDs: a note created offline already has its final id.
- Triggers for the sequence and for tombstones: any writer (EF, `ExecuteUpdate`, FK `SET NULL`) is covered without remembering to stamp.
- The app never mixes sources: stores read the local database only. Search and trash are the two exceptions (they need the server) and are online-only on purpose.

**How to verify**
1. Restart the API (the migration `AddSync` is applied to your dev database) and reload the page with Ctrl+Shift+R. The first load downloads your notes; the line above your email says "All changes synced".
2. DevTools, Network, set "Offline". The line says "Offline". Edit a note, create one, pin one: all works at once; the line counts "N changes waiting". (Do not reload the page while offline: that needs the PWA, Phase 9.)
3. Set the network back to "No throttling": within a few seconds the line returns to "All changes synced". Check in pgAdmin: `SELECT id, title FROM notes ORDER BY updated_at DESC`.
4. Two devices: open the app in two different browsers (or one normal and one private window) with the same account. Take one offline, edit the same note in both, bring it back: the last writer's text stays, the other text is in `note_revisions`, and the page shows a notice.
5. Sign out while offline with a pending change: a dialog warns that the change would be lost. DevTools, Application, IndexedDB: the `inknote-<id>` database is gone after a real sign-out.
6. `dotnet test --configuration Release` (243 tests), `ng test --watch=false` (357 tests).

**Pitfalls (met while building)**
- IndexedDB data is per origin, and a private window has none that lasts: the app says so instead of failing silently.
- Dexie `transaction()` takes at most 7 tables as arguments; pass an array for more.
- A live query's first answer is asynchronous: tests must wait for it (`vi.waitFor`), and a promise tied to a superseded request must still be settled (a store method that never resolved hung `Promise.all`; fixed with a `superseded` result).
- A result that arrives after the browser announced "offline" must not set the status back to "idle" (a race found in the real browser).
- **Reloading on `/notes/<id>` showed "Cannot load the note"** (found by the user, not by my tests): the editor (a child route) started reading the local database while the page was still opening it. Fix: the page renders its `router-outlet` only after the database is open. Lesson: a component that depends on something asynchronous must not be created before it is ready, and the tests must also cover the entry point a user really uses (a reload on a deep link), not only clicking through the app.
- A test or script that types into the editor right after navigating must wait for the NEW note's title box: for a few milliseconds the previous note's editor is still on screen.
- The 2 s settle window makes two devices see each other's change with a small delay; tests set it to 0, and the browser test presses "synchronize now" again like a user.

**Honest limits**: reloading the page offline needs the PWA (Phase 9); search and trash need the server; revisions have no screen yet (Phase 11); a change not yet sent is lost if the user signs out anyway; data on the device is not encrypted; other devices learn about a change by polling (SignalR in Phase 8 makes it immediate).

**Key takeaways**
- Make the local database the single source for the UI, and move the network behind a queue: failure of the network stops being a UI problem.
- When two writers can happen at once, decide the rule first (here: last write wins + keep the loser as a revision) and write the tests for it before the UI.
- Races hide in "who numbers first vs who commits first": put the guarantee where all writers pass (database triggers) and add a safety margin (the settle window).
