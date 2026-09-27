# Memory - Working (pointer)

> The canonical task state lives in `.dsh-project-memory/tasks.json`.
> The invariant source of truth lives in `memory/facts.md`.
> This file is a pointer only — keep it under ten lines.

## Pointer

- Task tracker: `.dsh-project-memory/tasks.json` (read it first when resuming work)
- Invariants: `memory/facts.md`
- Recent session narratives: `memory/episodes/*.md`

## Active branch

- `main` — currently diverged from `origin/main`; reconcile before pushing.

## If you change this file

Don't add historical narrative here. Update `tasks.json` and/or `facts.md`.
This file is a one-page pointer so future agents land on the right file fast.


## Later close-out (2026-09-20)

Fixed after this report. Not a rewrite of the original findings.

- Onboarding crawl budget now passes clamped env limits. Explicit options still win.
- Search opening-bid coverage counts the current page only. No catalog fraction.
- Lint CI runs `npm run lint` (`tsc --noEmit`). No eslint config.
- Seed count is 2093. Do not cite 2096.

Still open: CSP `unsafe-inline`, live Postgres round-trip, gsa/irs/nationwide HUD promotion, operator secrets. Ledger: `docs/GAP_CLOSEOUT_2026-09-20.md`.
