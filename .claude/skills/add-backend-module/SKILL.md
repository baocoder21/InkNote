---
name: add-backend-module
description: Create a new module in InkNote's .NET modular monolith (Notes, Tags, Search...) using the Domain/Application/Infrastructure/Api structure. Use when adding a new module or endpoint in the backend.
---

# Add a backend module

Read first: `CLAUDE.md`, `.claude/rules/backend.md`, and the module's row in `docs/PROJECT_MAP.md`. Do not read other modules unless you must call them through their contracts.

1. Create `src/backend/Modules/<Name>/` with 4 folders/projects: `Domain`, `Application`, `Infrastructure`, `Api`.
2. Domain: entities (with `UserId`, plus `Version`/`IsDeleted` for synced data). Application: use cases + FluentValidation + public interfaces (contracts).
3. Infrastructure: EF Core configuration (`IEntityTypeConfiguration`), then add a migration (`dotnet ef migrations add ...`).
4. Api: register endpoints (`[Authorize]` by default) and an `Add<Name>Module(this IServiceCollection)` extension; call it in `Program.cs`.
5. Add xUnit + Testcontainers tests for the main use cases.
6. Run `dotnet build` and `dotnet test` for the module.
7. Run the `update-project-map` skill to record the new module, endpoints and tables.
