---
name: update-project-map
description: Update docs/PROJECT_MAP.md after adding, removing or renaming a module, feature, endpoint or DB table. Use when the project structure changes, or when the map looks outdated.
---

# Update PROJECT_MAP

Purpose: keep `docs/PROJECT_MAP.md` accurate so the whole project never needs to be re-read.

1. Identify what changed (which module/feature/endpoint/table). Use `git diff --stat` if git is available; otherwise rely on the files just edited.
2. Open `docs/PROJECT_MAP.md` and edit only the relevant lines:
   - Add/update rows in the Backend/Frontend/Database tables (the Location column holds real paths; verify with Glob).
   - Add new "key entry points" (Program.cs, DbContext, app.config.ts, routes) if any.
3. If it is an architectural decision, add 1-3 lines to `docs/DECISIONS.md`.
4. Do not list individual files/classes; stay at module/feature and entry-point level. Keep each line short.
5. To verify a path, use Glob/Grep, not by reading whole directories.
