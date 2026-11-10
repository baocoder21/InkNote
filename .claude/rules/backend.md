---
paths:
  - "src/backend/**"
---

# Backend rules (.NET 9)

- Modular monolith: each module lives in `Modules/<Name>/` with `Domain`, `Application`, `Infrastructure`, `Api`. Other modules may only call public interfaces (contracts), never another module's DbSet/entities.
- Keep controllers/minimal APIs thin; logic lives in Application. Validate input with FluentValidation; return errors as ProblemDetails.
- EF Core + Npgsql: all schema changes go through migrations; never edit the DB by hand. Queries must always filter by the current user's `UserId`.
- Notes use soft delete (`IsDeleted`) and `Version` for sync conflict checks; editing a Note must create a `NoteRevision`.
- Auth: Identity + JWT (short-lived access token, rotating refresh token). Endpoints require `[Authorize]` by default.
- Log with Serilog (structured); never log note content or tokens.
- Use `IMemoryCache` behind an abstraction so switching to Redis later does not require changing call sites.
- Tests: xUnit + Testcontainers (real PostgreSQL); do not mock DbContext.
- After adding/changing a module, endpoint or table: update `docs/PROJECT_MAP.md`.
