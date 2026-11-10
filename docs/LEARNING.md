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
