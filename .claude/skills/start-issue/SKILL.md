---
name: start-issue
description: Start work on a bookit task — load a GitHub issue by number (or take a task described in chat), create the correctly named branch, and produce an execution-ready implementation plan. Use whenever the user says "start issue N", "zacznij issue N", "weź #N", gives an issue number to work on, or describes a task they want branched and planned for auto-mode execution.
---

# Start Issue

Turn a GitHub issue (or an ad-hoc task from chat) into a correctly named branch plus a plan complete enough to execute in auto mode without further questions.

## 1. Get the task

- Numeric argument (`51`, `#51`): `gh issue view <N> --json number,title,body,labels,state`
- Free-text argument: that IS the task. Also grep `docs/BACKLOG.md` for a matching planned issue — it may carry acceptance criteria and dependencies the user didn't repeat.
- No argument: ask which issue number or what task.

If the issue is CLOSED, say so and stop — the user probably typed the wrong number.

## 2. Check dependencies

Issue bodies list `**Zależy od:** #N`. For each referenced issue run `gh issue view <N> --json state,title`. If a dependency is still OPEN, do not stop — but the warning must be the first line of the plan (`⚠️ Zależy od otwartego #N — <title>`), so the user decides at approval time whether to proceed anyway.

## 3. Create the branch

Convention (see existing branches): `<type>/<issue-number>-<slug>`, e.g. `chore/1-docker-compose-env`.

- **type** from labels: `infra` → `chore`, `docs` → `docs`, bug reports → `fix`, everything else (`backend`, `frontend`, features) → `feat`
- **slug**: 2–4 lowercase words from the title, ASCII only (strip Polish diacritics: ł→l, ż→z, …), hyphen-separated
- chat task with no issue number: drop the number → `<type>/<slug>`

Branch off up-to-date main, never off the current branch:

```bash
git fetch origin main
git switch -c <branch> origin/main --no-track
```

If the working tree is dirty, stop and ask what to do with the changes — never stash or discard on your own.

## 4. Understand before planning

The plan is only as good as the reading behind it. Based on labels:

- Read the issue's related sections in `docs/SDD.md` (issues reference SDD sections; the data model is §4, env vars §8).
- `backend` → read `BACKEND_CLAUDE.md` and the relevant existing code in `apps/api`
- `frontend` → read `FRONTEND_CLAUDE.md` and the relevant existing code in `apps/web`
- `infra` → root configs (`docker-compose.yml`, `nx.json`, workflows)

Resolve every open question now, during research — a plan that defers decisions cannot run in auto mode.

## 5. Plan

Enter plan mode and present a plan that contains:

1. Dependency warnings, if any (first line).
2. Steps mapped 1:1 to the issue's acceptance criteria — every checkbox must be covered by a concrete step naming the files to create or change.
3. Tests for non-trivial logic (global definition of done requires at least one).
4. Final verification step: `npm exec nx run-many -t test lint build` must pass, plus the rest of the global DoD from `docs/BACKLOG.md` §"Jak korzystać" (DTO z walidacją class-validator, poprawne kody HTTP, UI po polsku).
5. A suggested conventional commit message referencing the issue, e.g. `feat: add auth register/login (#3)`.
