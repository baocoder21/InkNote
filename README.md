# InkNote

A local-first Markdown note app (web + installable PWA) for personal use. Notes live on the device (IndexedDB) and sync to
your own server when there is a connection. Plan: [PLAN.md](PLAN.md). Phases: [docs/PHASES.md](docs/PHASES.md). Where
things are: [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md). Why things are the way they are: [docs/DECISIONS.md](docs/DECISIONS.md).

Stack: Angular 22 + ng-zorro + CodeMirror 6 (frontend), .NET 9 + ASP.NET Core + EF Core (backend), PostgreSQL, MinIO (files).
It is meant to run on ONE machine, for one person, and is not meant to be put on the internet (see DECISIONS).

## Run it, option 1: everything in Docker

```bash
cp .env.example .env          # then set JWT_KEY in .env (openssl rand -base64 48)
docker compose --profile app up -d --build
```

Open http://localhost:8080 and register. Stop with `docker compose --profile app down` (your data stays in the volumes).
All ports are bound to `127.0.0.1`: only this computer can reach the app.

## Run it, option 2: develop on the host

```bash
docker compose up -d          # only PostgreSQL (5433) and MinIO (9000, console 9001)
```

One time, in `src/backend/InkNote.Api` (secrets are not stored in the repository):

```bash
dotnet user-secrets set "ConnectionStrings:Default" "Host=localhost;Port=5433;Database=inknote;Username=inknote;Password=inknote_dev"
dotnet user-secrets set "Jwt:Key" "<a long random string, at least 32 characters>"
dotnet user-secrets set "Storage:AccessKey" "inknote"
dotnet user-secrets set "Storage:SecretKey" "inknote_dev_secret"
dotnet dotnet-ef database update      # create / update the tables
```

Then, in two terminals:

```bash
dotnet run --launch-profile http      # in src/backend/InkNote.Api  -> http://localhost:5032 (Swagger: /swagger)
npm start                             # in src/frontend             -> http://localhost:4200
```

To try the installable / offline version: `npm run preview` in `src/frontend` (production build on http://localhost:4300).

## Tests

| What | Command | Notes |
|---|---|---|
| Backend (API, database, storage) | `dotnet test src/backend/InkNote.sln` | Starts PostgreSQL and MinIO containers by itself. If the API is running, add `--configuration Release` |
| Frontend (components, services) | `npm test -- --watch=false` in `src/frontend` | |
| End to end (real Chrome, the whole system) | `npm run e2e` in `src/frontend` | Needs the Docker system running (option 1). Add `POSTGRES_DB=inknote_e2e` to `.env` to keep your notes apart |

GitHub Actions ([.github/workflows/ci.yml](.github/workflows/ci.yml)) runs all three on every push.

## Back up your notes

Everything you wrote is in the Docker volumes `inknote-db-data` (notes) and `inknote-storage-data` (pictures and files).
A copy of the notes as plain files is always one click away: **Import & export** in the sidebar, "Export all notes".
