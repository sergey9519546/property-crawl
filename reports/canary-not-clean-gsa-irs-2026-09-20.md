# Migration 014 canary outcomes — gsa + irs (2026-09-20)

Promotion gate held. Neither source is promoted.

| Source | Attempt | Result | Reason |
|---|---:|---|---|
| **gsa** | 2 | NOT_CLEAN | Publisher robots exclusion on `/our-listing` — collector fail-closed (`SCRAPER_RESPECT_ROBOTS` left at default). Override is operator-only and **not** used here. |
| **irs** | 2 | NOT_CLEAN | Live auction list returned **0** real-estate cards (`accepted must be > 0`). Empty publisher inventory is not a clean canary. |

## Policy

- Do **not** promote on zero-yield or robots-blocked runs.
- Do **not** set `SCRAPER_RESPECT_ROBOTS=0` to force promotion.
- IRS may become promotable when publisher lists real-estate assets again; rerun `canary:live run --sources irs --repeat 2`.

## Still promoted (prior evidence)

treasury · usda · hud(OH,NJ) · servicelink
