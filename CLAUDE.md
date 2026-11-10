# InkNote

A Markdown note-taking app (web + desktop PWA), local-first. Details: [PLAN.md](PLAN.md).

## Working principles (important)

- **Do NOT read the whole project.** Start from [docs/PROJECT_MAP.md](docs/PROJECT_MAP.md) to find where modules/features live, then read only the relevant files. Use Grep/Glob instead of reading entire directories.
- When adding, removing or renaming a module, feature, API endpoint or DB table: **update `docs/PROJECT_MAP.md` in the same change** (use the `update-project-map` skill).
- Record important architectural decisions in `docs/DECISIONS.md` (1-3 lines each: what and why).
- PLAN.md is the source of truth for the tech stack. Do not change the stack without asking the user.

## Learning mode (important)

This is the user's first project. They want to learn and fully understand each technology and how it is implemented as they go. For every phase/step:

- **Before coding:** briefly explain the goal, the concept/technology involved (what it is, why we use it here, how it fits the architecture), and the plan for the step. Assume little prior knowledge; define terms on first use.
- **While coding:** keep steps small so each one can be understood and verified; say what each important file/block does and why it is written that way. Point out trade-offs and common pitfalls.
- **After coding:** summarize what was built, how to run/verify it, and 2-3 key takeaways. Suggest what to read or try next (official docs links are welcome).
- Do not do several phases in one go without checking in. Pause after each phase so the user can ask questions.
- Prefer the simplest approach that teaches the concept correctly; avoid adding abstractions before they are needed, and say when something is deliberately simplified.
- Record short learning notes for each completed phase in `docs/LEARNING.md` (concept, why, how to verify).
- Explanations are given in Vietnamese in chat; code and docs stay in English.

## Stack (summary)

- Frontend: Angular 22, SASS, ng-zorro (fallback: PrimeNG), CodeMirror 6, KaTeX, Mermaid, remark, DOMPurify. State: Signals + NgRx SignalStore; RxJS for HTTP/streams; Dexie (IndexedDB) for local-first.
- Backend: .NET 9, ASP.NET Core, EF Core + Npgsql, SignalR, Identity + JWT. Modular monolith.
- DB: PostgreSQL. Cache: IMemoryCache (Redis later). Desktop: PWA.

## Directory layout (planned, update when scaffolded)

- `src/backend/` – .NET solution, one folder per module in `Modules/<Name>/`
- `src/frontend/` – Angular workspace, one folder per feature in `src/app/features/<name>/`
- `docs/` – PROJECT_MAP.md, DECISIONS.md
- `.claude/rules/` – scoped rules; `.claude/skills/` – repeatable workflows

## General conventions

- Write code, comments, documentation and commit messages in English. Chat with the user in Vietnamese.
- Keep changes small and focused; no refactoring outside the requested scope.
- Never commit secrets; configure via environment variables / user-secrets.
- Run the build and tests for the part you changed before reporting completion.
