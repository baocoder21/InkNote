# PROJECT MAP

> Project map for locating code quickly without reading the whole repo. Always update it when the structure changes (skill `update-project-map`).
> Status: **Phase 0 scaffolded** – .NET API skeleton + Angular workspace + PostgreSQL compose file. No feature modules yet.

## Backend (`src/backend/`)

| Module | Responsibility | Location | Main endpoints |
|---|---|---|---|
| Notes | Note CRUD, revisions | _(not created)_ | |
| Notebooks/Tags | Nested notebooks, tags | _(not created)_ | |
| Auth | Identity, JWT, refresh token | _(not created)_ | |
| Sync | Client↔server sync, SignalR hub | _(not created)_ | |
| Search | Full-text (tsvector, pg_trgm) | _(not created)_ | |
| Attachments | Upload, object storage | _(not created)_ | |

## Frontend (`src/frontend/`)

| Feature | Description | Location | Main store / service |
|---|---|---|---|
| editor | CodeMirror + preview | _(not created)_ | |
| notes-list | List, search | _(not created)_ | |
| sidebar | Notebooks, tags | _(not created)_ | |
| auth | Login/register | _(not created)_ | |
| sync | Dexie + sync queue | _(not created)_ | |

## Database

| Table | Owning module | Notes |
|---|---|---|
| User, Notebook, Note, Tag, NoteTag, Attachment, NoteRevision | see PLAN.md §4 | |

## Key entry points

- `global.json` – pins .NET SDK 9.0.x
- `docker-compose.yml` – local PostgreSQL 17 (`db`, port 5432, volume `inknote-db-data`)
- `src/backend/InkNote.sln` – solution; `src/backend/InkNote.Api/` – web API project
- `src/backend/InkNote.Api/Program.cs` – DI registration, CORS, pipeline, `GET /api/health`
- `src/backend/InkNote.Api/appsettings.Development.json` – `Cors:AllowedOrigins` (Angular dev server)
- API dev URL: `http://localhost:5032` (see `Properties/launchSettings.json`)
- `src/frontend/` – Angular 22 workspace (standalone, SCSS, Vitest, no SSR); dev URL `http://localhost:4200`
- `src/frontend/src/app/app.config.ts` – providers (router, `provideHttpClient`)
- `src/frontend/src/app/core/` – `api.config.ts` (API base URL), `health.service.ts` (calls `/api/health`)
- `src/frontend/src/app/app.ts|html` – root component showing API health status
