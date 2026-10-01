# property-crawl — module depth & seam analysis

An audit using the deep-module vocabulary: **interface** (everything a caller must know), **implementation**, **depth** (behaviour per unit of interface), **seam** (where an interface lives), **adapter** (something that satisfies an interface at a seam).

Method: instrument every source file for exported names, parse class bodies for public method counts, and resolve the reference graph. Numbers below are measured, not estimated.

## Scale

| Area | Files | Lines | Exported names |
|---|---|---|---|
| `server/` | 149 | ~24k | ~180 |
| `src/` | 223 | ~27.8k | ~304 |
| `test/` | 258 | ~41.0k | — |
| `scripts/` | ~40 | ~4k | — |

Test-to-implementation line ratio is roughly 1.6:1. That is a genuinely tested codebase, and most of it is now executed in CI.

---

## The scraper seam is real, large, and completely undeclared

This is the central finding.

The scheduler and collection coordinator require **exactly nine members** of every scraper:

```
circuitBreaker, fixtureOnly, getRawPublisherRecord, historicalOnly,
lastRunReport, name, scrapeFeed, setCheckpoint, sourceKey
```

There are **24 adapters** at this seam. And there is **no interface, no type, no doc comment, and no test that asserts a scraper provides them.** `grep -r "interface Scraper\|type Scraper\|ScraperAdapter"` across `server/` and `src/` returns nothing.

A real seam with 24 adapters is exactly the case where the interface should be enforced. Instead the contract is folklore, recoverable only by grepping for `scraper.` in the scheduler.

### Optional members drifted badly

| Member | Adapters providing it |
|---|---|
| `getCollectionScope` | 9 / 24 |
| `getRawPublisherRecord` | 5 / 24 (now 24 via a base-class default) |
| `passesFilter` | 4 / 24 |
| `setCheckpoint` | 2 / 24 |
| `checkpointScope` | 1 / 24 |
| `checkpointState` | 1 / 24 |
| `errorSummary` | 1 / 24 |

`hud.js` invented its own vocabulary for concepts other adapters do not expose at all. `hud.js:103`:

```js
checkpointScope() { return this.getCollectionScope(); }
```

A one-line alias, called from exactly one place — `hud.js:118` — inside the same class. Deletion test: removing it costs nothing. It is rename residue that reads like a distinct capability.

### Why this matters more than style

An undeclared seam at 24 adapters has no failure mode — it degrades. Nothing breaks when an adapter drifts, so drift accumulates silently:

- `hud-usps-vacancy` sat in the scheduler with `adapterKey: null` in the catalog. The cadence join silently returned `24h` for a dataset declared `2160h`, and operator-triggered runs were refused — because nothing joined the catalog's `adapterKey` to the scheduler's `sourceKey` for you.
- `getRawPublisherRecord` existed on 6 adapters. The scheduler's fallback (`JSON.parse(listing.raw)`) silently stored **derived data in the publisher-raw column** for every other adapter, because `raw` is text and the parse threw. That was not found by a test; it was found by reading a fall-through.
- Both bugs were invisible *because the seam has no interface to violate*.

**Recommendation.** Name the interface and check it. A `validateScraperAdapter(scraper)` called once when the scheduler assembles its adapter list, asserting the 9 required members and rejecting unknown extras, converts every one of these from a silent drift into a startup failure. That is one function in `scheduler.js` and it is worth more than the 92 lines of adapter consistency tests that do not exist.

---

## Depth is good almost everywhere

The implementation quality is genuinely high. Most modules are deep — large implementation, small interface:

| Module | Implementation | Interface |
|---|---|---|
| `server/db/client.js` (`DatabaseClient`) | 1058 lines | 1 export, 25 methods |
| `server/routes/property-image.js` | 1179 | 1 |
| `server/scrapers/ca-controller-tax-sale.js` | 559 | 1 |
| `server/scrapers/civilview.js` (`CivilViewScraper`) | 733 | 30 ⚠ |
| `server/scrapers/fhfa-hpi.js` | 229 | 6 |
| `server/scrapers/hud-usps-vacancy.js` | 275 | 7 |

`FhfaHpiScraper` and `HudUspsVacancyScraper` are the model: a scraper's real interface is `scrapeFeed` plus one or two hooks. Everything else is private.

### `CivilViewScraper` is the one badly-shaped scraper

733 lines behind a **30-method public interface** — four times wider than its siblings for the identical role. Roughly half of that interface is pure parsing helpers no caller should ever reach:

```
field, parseAddress, formatAddress, parseSaleDate, parseMoney,
parseExecutionAmount, parseDescriptionUpset, parseLabeledNote,
parseOccupancy, cleanText, decodeHtml, positiveInt,
boundedProjectionText, errorMessage, cookieHeader
```

Deletion test: if `CivilViewScraper` were deleted, would that complexity reappear in callers? No — it is called for `scrapeFeed` alone. The interface is wide because the methods were never made private.

**Recommendation.** Prefix the helpers `_` or move them to module scope. The implementation is good; only the interface leaks.

---

## Two modules with misplaced state

### `PgCollectionJobStore` — 10 lines, 7 methods

```js
createOrReuse(input){ return this.discoveryStore.createOrReuseJob(input); }
get(id)          { return this.discoveryStore.getJob(id); }
list(limit)      { return this.discoveryStore.listJobs(limit); }
update(id,update){ return this.discoveryStore.updateJob(id,update,{ownerId:this.claimOwners.get(id)}); }
async claim(id,owner,ttl){ … }
renewClaim(id,owner,ttl){ … }
bindClaim(id,owner){ … }
```

**The seam is real, not hypothetical.** `collection-coordinator.js:183` selects between two adapters:

```js
this.store = options.store || (this.database?.isPg && DISCOVERY_MODE==='advanced'
  ? new PgCollectionJobStore(createDiscoveryStore(this.database)) : new CollectionJobStore(options));
```

One adapter for a JSON file store, one for Postgres. That is the "two adapters means a real one" case, and it should stay.

The defect is narrower and more interesting: **the only behaviour this adapter adds is a `claimOwners` Map.** Every other method is a name remap. And claim ownership is store state — `DiscoveryStore` already implements `claimJob`, `renewJobClaim` and the lease, so the owner mapping belongs there, not in a 10-line shim beside it.

As written, the adapter is a rename layer that also holds a cache of state the store already tracks, so a `claim` through any other path (the store is directly reachable, and `test/discovery-acceptance-store.test.js` constructs `DiscoveryStore` itself) will not see the owner. That is a latent divergence, not a hypothetical.

**Recommendation.** Keep the seam; move `claimOwners` onto `DiscoveryStore` so the claim→owner mapping has one owner. The adapter then becomes a pure name remap, which is a legitimate if unexciting adapter. Do not delete the seam.

### `DiscoveryStore` — 24 methods, 110 lines

The inverse failure. Twenty-four public methods over 110 lines of implementation is roughly four lines each — they are SQL wrappers. This is where depth *should* live and does not:

- `getCheckpoint` is a bare `SELECT` returning `rows[0] || null`.
- `saveCheckpoint` is a bare `INSERT ... ON CONFLICT`.
- `finishRun` is a bare `UPDATE`.

A caller who wants to record a checkpoint must know the column names, the `ON CONFLICT` key, and that `hash(scope)` is the dedup mechanism. That is interface knowledge that should be behind the seam.

It is also where the claim-ownership state from `PgCollectionJobStore` belongs, for the reason above.

Real depth here would be `recordCheckpoint(sourceKey, cursor, scope)` owning scope hashing and conflict semantics, or a higher-level `advanceSource(sourceKey, {cursor, run, snapshots})` that owns the whole progress story. Right now the coordinator must orchestrate the correct sequence itself.

---

## `DatabaseClient` is a god module

1058 lines, **25 public methods**, and it is the data interface for at least four unrelated aggregates:

| Aggregate | Methods |
|---|---|
| listings | `getListings`, `getListingById`, `createListing` |
| saved deals | `getSavedDeals`, `saveDeal`, `removeSavedDeal` |
| saved searches | `createSavedSearch`, `listSavedSearches`, `getSavedSearchById`, `updateSavedSearch`, `deleteSavedSearch` |
| alert matches | `recordAlertMatches`, `listAlertMatches`, `markAlertMatchesRead` |
| AI cache | `getAiCache`, `setAiCache` |
| history | `recordListingHistorySnapshots`, `getListingHistory` |
| lifecycle | `init`, `verifyConnection`, `dataMode`, `seedInMemory`, `refreshLiveCache` |

Locality is poor: a change to `markAlertMatchesRead` has nothing to do with `getListingHistory`, yet both are one object a caller must hold in their head. `dataMode` delegates directly and is a trivial accessor on the widest interface in the codebase.

This is also the module that grew the cross-source merge semantics (`canonicalStatus`, `prepareListingForPersistence`, `applyCrossSourceBakeOff`, `computeBakeOff`) — so it is deep *and* god, which is the dangerous combination: real behaviour hidden behind an interface nobody can hold.

**Recommendation.** Split along the aggregate lines above, keeping one implementation for the Postgres path and one for in-memory behind a seam. The seam is real already — `isPg` branches throughout — it just is not expressed.

---

## Two good examples worth keeping

**`src/lib/discovery-query.ts`** — 35 lines, 3 functions, and one `keys` array drives both `readDiscoveryFilters` and `discoverySearchParams`. Read and write cannot drift because there is a single source of truth for the vocabulary. This is the shape the scraper seam should have.

**`BaseScraper`** — 171 lines, 10 public methods, and it genuinely earns them: retry, circuit breaker, request helpers, jitter, and the `standardizeListing` schema gate that every adapter inherits. Deep, and its interface is learnable.

---

## One loose end this audit introduced

`discovery-query.ts` declares 21 filter keys with no validation, while `server/discovery/query.js` now validates `freshness` and rejects unknown values with a 400. The workbench only ever sends server-supplied facet values, so the normal path is safe — but a bookmarked or hand-edited `/listings?freshness=fresh` will now 400.

That is the correct server behaviour (reject rather than silently match nothing), and the client is the loose end. `discovery-query.ts` should either validate the enum it re-emits or drop unknown buckets, so a stale bookmark degrades to "no filter" rather than an error.

---

## Priority

1. **Declare the scraper interface and assert it at assembly.** One `validateScraperAdapter()` prevents every drift class above. Highest leverage by an order of magnitude.
2. **Move claim ownership onto `DiscoveryStore`.** Keeps the real two-adapter seam, removes a second, divergent source of truth for who owns a claim.
3. **Make `CivilViewScraper`'s 15 parsing helpers private.** Same role as its siblings, 4× the interface width.
4. **Split `DatabaseClient` along its aggregates.** Deep but god; nobody can hold 25 methods.
5. **Give `DiscoveryStore` depth**, or accept it as an honest SQL wrapper and move the orchestration up into the coordinator.
6. **Validate enums in `discovery-query.ts`** so a stale bookmark degrades instead of erroring.
