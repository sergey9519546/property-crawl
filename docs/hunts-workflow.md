# Saved hunts workflow

Saved hunts turn a bounded set of listing criteria into a durable, explainable comparison against the current validated live inventory. They do not send notifications, infer a sale from a missing record, or treat a model estimate as a publisher fact.

## Authentication and routes

Every saved-hunt route is an operator surface. Configure `SCRAPER_ADMIN_TOKEN` on the API process and present the same value as either `Authorization: Bearer <token>` or `x-scraper-token: <token>`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/hunts` | List definitions. Returns `{ "items": [...] }`. |
| `POST` | `/api/hunts` | Create a definition. Returns `201 { "hunt": ... }`. |
| `GET` | `/api/hunts/:id` | Read one definition with its retained criteria versions, baseline summary, and recent events. |
| `PATCH` | `/api/hunts/:id` | Change its name, enabled state, or criteria. Returns `{ "hunt": ... }`. |
| `DELETE` | `/api/hunts/:id` | Delete its definition, baseline, and events. |
| `POST` | `/api/hunts/:id/evaluate` | Evaluate the complete live inventory. Returns `{ "evaluation": ... }`. |
| `GET` | `/api/hunts/:id/events?limit=50` | Read up to 200 newest events. Returns `{ "items": [...] }`. |

An API without an operator token returns `503`; a missing or incorrect presented token returns `401`. Evaluation returns `409` when the listing provider reports that its result is truncated. Lifecycle comparisons require a complete inventory so a page boundary cannot masquerade as disappearance.

The route module exports `createHuntsHandler({ database, env, filePath, now })`. The returned handler has the existing server signature `async (req, res, url)`. `database` must expose `getListings({ limit, offset })`.

## Definition contract

Create a hunt with a name, optional enabled state, and one flat criterion group:

```json
{
  "name": "PA sheriff sales under 250k",
  "enabled": true,
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

`mode: "all"` requires every rule to match. A failed rule makes the result `no_match`; otherwise unavailable evidence makes it `unknown`. `mode: "any"` matches when any rule matches, returns `no_match` when all rules fail, and returns `unknown` when none matches and at least one cannot be established.

The criteria surface is deliberately data-only. It accepts at most 20 rules and 16 KiB of normalized criteria. It never evaluates arbitrary expressions or code.

### Fields and operators

| Type | Fields | Operators |
| --- | --- | --- |
| String | `state`, `source`, `county`, `city`, `propType`, `status`, `occupancy`, `seniorLienRisk` | `eq`, `neq`, `in`, `not_in`, `known`, `unknown` |
| Number | `openingBid`, `estLow`, `estHigh`, `assessed`, `mid`, `ratio`, `equity`, `dealScore`, `redemptionDays`, `sqft`, `beds`, `baths`, `year` | `eq`, `neq`, `gte`, `lte`, `between`, `known`, `unknown` |
| Date | `saleDate`, `sourceObservedAt` | `before`, `on_or_before`, `after`, `on_or_after`, `between`, `known`, `unknown` |

`in` and `not_in` accept 1–20 values. `between` accepts exactly two inclusive ordered bounds. String comparison is normalized: state is uppercase and other string fields are lowercase. Dates are normalized to ISO timestamps.

`known` matches only a present, valid value; `unknown` matches only an absent or invalid value. Every other operator returns `unknown` when its input evidence is unavailable. Evaluation returns each clause with its normalized expected and actual value, tri-state status, evidence class, and a short reason.

The following fields are model or rule outputs rather than publisher facts: `mid`, `ratio`, `equity`, `dealScore`, `redemptionDays`, and `seniorLienRisk`. A model label alone is insufficient. `mid`, `ratio`, and `dealScore` are accepted only when their declared observed-range inputs are present and the stored value can be reproduced from those inputs. Rule-derived fields require the expected model class and present declared inputs. Their clause result remains labeled as derived evidence. The current normalization field named `equity` is a bid-to-midpoint spread without debt evidence, so the hunt evaluator always treats it as unknown. A future debt-adjusted equity scenario needs a separate validated provenance contract before this criterion can match.

A normally publisher-reported field such as `sqft` or `assessed` also becomes unavailable to hunts when its own key appears under `provenance.derivedFields`. This prevents an exterior proxy, regional estimate, or other derived replacement from passing a publisher-fact rule.

## Evaluation response

An evaluation contains:

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
  "newEvents": []
}
```

Accepted result records expose only review-safe evidence: `identityKey`, `listingId`, optional `address`, `sourceId`, `sourceUrl`, `observedAt`, tri-state `status`, and `clauseResults`. Rejected records explain why they did not qualify as validated live evidence. Raw scraper payloads are not returned.

When a submitted record is older than or equal to the retained observation for the same publisher identity, the result reports the retained status and values with `observationDisposition: "older_ignored"` and `ignoredObservedAt`. Counts likewise describe the effective retained state rather than the stale submission.

Only listings that pass the ingestion validator, declare `provenance.origin: "live"`, identify their exact publisher record, carry an HTTPS source URL accepted by that validator, and have a non-future observation time may enter a baseline. Duplicate publisher records collapse to the newest observation. An older or equal observation cannot overwrite a newer baseline record.

## Lifecycle semantics

The initial evaluation creates the comparison baseline and emits no lifecycle events. A later, newer observation of the same publisher record can create:

- `new_match`: a new record matches, or the same record moves from `no_match`/`unknown` to `match`.
- `material_change`: a matching record remains a match and supported material values changed.
- `no_longer_matches`: a matching record is now explicitly `no_match`.
- `evaluation_unknown`: an evaluable record now lacks evidence needed to establish the hunt.

Events include `listingId`, optional `address`, source identifier and URL, publisher observation time, detection time, previous/current states, changed fields, and the current clause evidence. Event IDs are stable hashes, so retrying the same observation does not duplicate an event.

A record omitted from a later inventory increments `notObserved` and remains in the baseline. Omission never produces `no_longer_matches`, `sold`, `redeemed`, or any other outcome. A refresh with only a newer `sourceObservedAt` creates no material-change event. Observation time orders evidence and may cause a rule-status transition for a date comparison, but it is not itself a material property fact; a `sourceObservedAt known` rule therefore stays quietly matched across refreshes.

Changing normalized criteria creates a new immutable criteria version and clears the old comparison baseline. The next run establishes a fresh baseline without transition noise. Up to 20 recent criteria versions are retained.

## Durability and limits

The default store is `.cache/saved-hunts.json`; override it with `PROPERTY_HUNTS_PATH` or an injected `filePath`. Writes use an exclusive sibling lock, a mode-`0600` temporary file, and atomic rename. A corrupt or oversized existing store fails closed and remains untouched.

The store is capped at 20 MiB, 50 hunt definitions, 2,000 events, 10,000 baseline records per hunt, and 25,000 baseline records in total. Evaluation responses return at most 500 record results and 200 new events, with explicit truncation flags. These response caps do not change the stored baseline.
