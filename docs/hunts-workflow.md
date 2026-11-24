# Saved hunts workflow

Saved hunts turn a bounded set of listing criteria into a durable, explainable comparison against the current validated live inventory. They never infer a sale from a missing record or treat a model estimate as a publisher fact. When configured with `notifyEmail` or `webhookUrl`, hunts dispatch change alerts and scheduled deal digests.

## Authentication, member scoping, and routes

`server/routes/hunts.js` protects all `/api/hunts` routes with `SCRAPER_ADMIN_TOKEN` (`Authorization: Bearer <token>` or `x-scraper-token: <token>`). Next.js member routes (`src/app/api/hunts/route.ts`) proxy authenticated member requests with `x-pp-account`:

- **Member scope (`x-pp-account`)**: Members see, modify, evaluate, and delete only their own `owner: "account:<id>"` hunts (up to 20 hunts per account). Invalid `x-pp-account` headers return `400`.
- **Analyst scope (`x-pp-role: analyst` without `x-pp-account`)**: Sees non-member hunts.
- **Operator scope (no `x-pp-account`, non-analyst)**: Sees and manages all hunts across accounts.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/hunts` | List visible definitions. Returns `{ "items": [...] }`. |
| `POST` | `/api/hunts` | Create a definition (`name`, `enabled`, `criteria`, optional `notifyEmail`, optional `webhookUrl`). Returns `201 { "hunt": ... }`. |
| `GET` | `/api/hunts/:id` | Read one definition with retained criteria versions (file store), baseline summary, and recent events. |
| `PATCH` | `/api/hunts/:id` | Update `name`, `enabled`, `webhookUrl`, `notifyEmail`, or `criteria`. Returns `{ "hunt": ... }`. |
| `DELETE` | `/api/hunts/:id` | Delete its definition, baseline, and events. |
| `POST` | `/api/hunts/:id/evaluate` | Evaluate the complete live inventory and trigger `notifyHuntWebhook` / `notifyHuntEmail` on changes. Returns `{ "evaluation": ... }`. |
| `GET` | `/api/hunts/:id/events?limit=50` | Read up to 200 newest events. Returns `{ "items": [...] }`. |
| `POST` | `/api/scrapers/run?action=dispatch-digests` | Evaluate enabled hunts against current inventory and send HTML/Markdown digest emails via `runAllHuntDigests`. |

An API without `SCRAPER_ADMIN_TOKEN` returns `503`; a missing or incorrect token returns `401`. File-backed evaluation returns `409` when `scanAllListings` reports that the listing provider result is truncated so a page boundary cannot masquerade as disappearance.

The route module exports `createHuntsHandler({ database, env, filePath, now, discoveryQuery, durableStore, webhookOptions })`. When `durableStore` is provided or `database.isPg && env.DISCOVERY_MODE === 'advanced'`, it uses `PgHuntStore` (`server/discovery/hunt-store.js`) and `discoveryQuery.search` cursor pagination; otherwise it uses the file-backed store (`server/intelligence/hunt-store.js`) and `scanAllListings`.

## Definition contract

A hunt accepts either **rule-based criteria** (`{ mode, rules }`) or **saved discovery filters** (`{ discoveryFilters }`), plus optional `webhookUrl` (HTTPS, SSRF-checked) and `notifyEmail`:

```json
{
  "name": "PA sheriff sales under 250k",
  "enabled": true,
  "notifyEmail": "buyer@example.com",
  "webhookUrl": "https://hooks.example.com/hunts",
  "criteria": {
    "mode": "all",
    "rules": [
      { "field": "state", "operator": "eq", "value": "PA" },
      { "field": "source", "operator": "in", "value": ["civilview", "sheriff"] },
      { "field": "openingBid", "operator": "lte", "value": 250000 }
    ]
  }
}
```

### Rule-based criteria (`mode` + `rules`)

`mode: "all"` requires every rule to match. A failed rule makes the result `no_match`; otherwise unavailable evidence makes it `unknown`. `mode: "any"` matches when any rule matches, returns `no_match` when all rules fail, and returns `unknown` when none matches and at least one cannot be established.

The criteria surface is strictly data-only (at most 20 rules and 16 KiB of normalized criteria) and never evaluates arbitrary expressions or code.

| Type | Fields | Operators |
| --- | --- | --- |
| String | `state`, `source`, `county`, `city`, `propType`, `status`, `auctionProgram`, `lifecycleStatus`, `transactionOutcome`, `occupancy`, `seniorLienRisk`, `distressStage` | `eq`, `neq`, `in`, `not_in`, `known`, `unknown` |
| Number | `openingBid`, `estLow`, `estHigh`, `assessed`, `mid`, `ratio`, `equity`, `dealScore`, `qualityScore`, `minQuality`, `redemptionDays`, `sqft`, `beds`, `baths`, `year` | `eq`, `neq`, `gte`, `lte`, `between`, `known`, `unknown` |
| Date | `saleDate`, `sourceObservedAt` | `before`, `on_or_before`, `after`, `on_or_after`, `between`, `known`, `unknown` |

- `in` and `not_in` accept 1–20 values. `between` accepts exactly two inclusive ordered bounds.
- `distressStage` rules accept either a single stage string or an array (`string[]`, automatically normalized on `eq`/`neq` to `in`/`not_in`), matching normalized `listing.distressStage`, `listing.lifecycleStage`, `listing.stage`, `listing.triage.distressStage`, or `mapDistressStage(source, saleDate, auctionProgram)` across canonical buckets (`reo`, `pre_foreclosure`, `scheduled`, `tax_sale`, `unknown`).
- `qualityScore` and `minQuality` accept numeric thresholds `0..100`, reading `listing.qualityScore`, `listing.researchQuality.score`, or `computeResearchQuality(listing, now).score`.
- String comparison is normalized: `state` is uppercase, `distressStage` normalizes hyphens/spaces to canonical snake_case buckets, and other string fields are lowercase. Dates are normalized to ISO timestamps.
- `known` matches only a present, valid value; `unknown` matches only an absent or invalid value. Every other operator returns `unknown` when its input evidence is unavailable (for example, `openingBid` `lte` returns `unknown` when `openingBid` is `null` or missing, never treating missing evidence as `0`).
- `mid`, `ratio`, and `dealScore` are accepted only when their declared `observed-valuation-range-v1` inputs (`openingBid`, `estLow`, `estHigh`) are present and reproducible. `redemptionDays` and `seniorLienRisk` exclude state-table or pattern markers under `provenance.derivedFields`.
- `equity` always evaluates to `unknown` because the legacy bid-to-midpoint spread has no debt-adjusted equity model. `underwriteScenario` belongs to workspace research cases (`server/intelligence/research-cases.js`) and is not accepted or evaluated by saved hunts.
- Normally publisher-reported fields such as `sqft` or `assessed` become unavailable to hunts when their key appears under `provenance.derivedFields`.

### Saved discovery criteria (`discoveryFilters`)

Searches saved from Discover use `{ "discoveryFilters": { ... } }` and cannot be combined with `mode` / `rules`. Supported `discoveryFilters` keys:

- `q`, `state`, `county`, `source`, `type`, `program`, `lifecycle`, `saleFrom`, `saleTo`, `maxBid`, `minScore`, `minEquity`, `occupancy`, `freshness`, `hasDocuments`, `seniorLien`, `redemption`, `distressStage` (`string` or `string[]`), `minQuality` (`0..100`).
- `discoveryFilters` mirrors `server/discovery/query.js` filter semantics (plus `minQuality` matching `qualityScore` / `computeResearchQuality`). Because discovery search uses boolean filtering, `maxBid` returns `no_match` when `openingBid` is `null` or missing (unlike tri-state `openingBid` rules, which return `unknown`).

## Evaluation, ranking, and notifications

An evaluation returns counts, ranked `results`, `unsatisfiableCriteria`, and `newEvents`:

```json
{
  "huntId": "hunt_...",
  "huntVersion": 1,
  "evaluatedAt": "2026-09-05T12:00:00.000Z",
  "baselineCreated": false,
  "counts": {
    "inventory": 12,
    "accepted": 10,
    "rejected": 2,
    "match": 3,
    "noMatch": 5,
    "unknown": 2,
    "newMatch": 1,
    "materialChange": 0,
    "noLongerMatches": 1,
    "evidenceUnknown": 0,
    "notObserved": 1,
    "olderIgnored": 0
  },
  "results": [],
  "unsatisfiableCriteria": [],
  "newEvents": []
}
```

Accepted result records expose only review-safe evidence (`identityKey`, `listingId`, optional `address`, `sourceId`, `sourceUrl`, `observedAt`, tri-state `status`, `clauseResults`, and `relevance` triage rank from `hunt-ranking.js`). Raw scraper payloads are never returned.

Only listings that pass ingestion validation, declare `provenance.origin` as `"live"` or `"email_notice"`, identify their exact publisher record, carry an HTTPS source URL accepted by that validator, and have a non-future observation time may enter a baseline. Duplicate publisher records collapse to the newest observation, and older or equal observations report `observationDisposition: "older_ignored"` without overwriting newer baseline state.

- **Webhooks and instant email alerts (`POST /api/hunts/:id/evaluate`)**: When `baselineCreated` is `false` and `newEvents` contains `new_match` or `material_change`, `notifyHuntWebhook` posts a signed/SSRF-pinned payload to `hunt.webhookUrl` and `notifyHuntEmail` sends an alert to `hunt.notifyEmail`.
- **Scheduled / batch digests (`POST /api/scrapers/run?action=dispatch-digests`)**: `runAllHuntDigests` (`server/delivery/alert-digest.js`) loads hunts and each hunt's prior baseline (via `PgHuntStore` when active, otherwise the file store), skips disabled/paused hunts cleanly, evaluates inventory, persists updated baselines/events, detects opening-bid price drops against the prior baseline, and dispatches HTML/Markdown digests to `hunt.notifyEmail || recipientEmail` via Resend when initial matches, actionable changes, or price drops are present.

## Lifecycle semantics

The initial evaluation creates the comparison baseline and emits no lifecycle events. A later, newer observation of the same publisher record can create:

- `new_match`: a new record matches, or the same record moves from `no_match`/`unknown` to `match`.
- `material_change`: a matching record remains a match and supported material values changed.
- `no_longer_matches`: a matching record is now explicitly `no_match`.
- `evaluation_unknown`: an evaluable record now lacks evidence needed to establish the hunt.

A record omitted from a later inventory increments `notObserved` and remains in the baseline; omission never produces `no_longer_matches`, `sold`, or `redeemed`. A refresh with only a newer `sourceObservedAt` creates no `material_change` event. Changing normalized criteria increments `version` and resets the comparison baseline.

## Durability and limits

- **File-backed store**: Default `.cache/saved-hunts.json` (override with `PROPERTY_HUNTS_PATH` or `filePath`). Uses an exclusive sibling lock, mode-`0600` temp file, and atomic rename. Capped at 20 MiB, 50 hunt definitions, 2,000 events, 10,000 baseline records per hunt, and 25,000 baseline records total. `runHunt` evaluates inventories in 1,000-record pages.
- **Durable PostgreSQL store (`PgHuntStore`)**: Active when `database.isPg` and `DISCOVERY_MODE === 'advanced'` (or injected `durableStore`). Persists hunts, baselines, and events in `discovery_hunts`, `discovery_hunt_baselines`, and `discovery_hunt_events` via bounded 500-row batches with version conflict checks (`409 HUNT_VERSION_CONFLICT`). `evaluateDurableInventory` pages `discoveryQuery.search` (`limit=1000`), unions `unsatisfiableCriteria` across pages, and preserves global `sortHuntResults` ranking before slicing to 500 returned `results` and 200 `newEvents`.
