# Audit 11 — Representative User Journeys Remediation & Underwriting Bridge (2026-11-08)

Scope: End-to-end verification and remediation of five representative user journeys (Homepage-to-Workbench Conversion Funnel, Underwriting-to-Research-Case & Decision Packet Export, Live Assessor Parcel Write-Through, Saved Search to Automated Hunt Promotion, and Triage Priority Sorting), eliminating six concrete runtime and state defects and establishing automated control verification.

---

## 1. Defects Audited at Runtime & Root Causes

Our adversarial trace of representative user journeys uncovered six concrete defects that previous unit test suites missed:

### Defect 1: Runtime Crash (TDZ `ReferenceError`) on Listings Without Published Opening Bid
- **File**: `src/components/terminal/bidding-simulator.tsx`
- **Symptom**: When `openingBid === null`, the simulator returned early with an inline form permitting buyer-assumed bids (`#custom-opening-bid-input`). Typing into this input immediately threw `ReferenceError: Cannot access 'updateCustomOpeningBid' before initialization`.
- **Root Cause**: `const updateCustomOpeningBid` was declared at line 232, below the `if (openingBid === null)` early return at line 179. In ES6 lexical scoping, functions declared via `const` are in the Temporal Dead Zone (TDZ) prior to execution of their declaration.
- **Fix**: Hoisted `updateScenario`, `updateCustomValuation`, and `updateCustomOpeningBid` above the early-return gate.

### Defect 2: Broken Underwriting-to-Research-Case & Decision Packet Continuity
- **Files**:
  - `src/components/research/research-case.tsx`
  - `server/intelligence/research-cases.js`
  - `src/app/research/[id]/export/page.tsx`
  - `src/components/research/decision-packet-view.tsx`
- **Symptoms**:
  1. Saved underwriting scenarios (`rehabBudget`, `targetMargin`, `maxAllowableOffer`, `holdingMonths`, `customValuation`, `customOpeningBid`, itemized closing costs) were invisible on `/research/[caseId]`.
  2. Local browser modeling in `sessionStorage` could not be synced to the case, and `saveDecision()` / `recheckSource()` dropped local assumptions.
  3. `buildPacket()` omitted `underwriteScenario` from `packet.case`, and `packetToMarkdown()` omitted decision rationale and underwriting assumptions.
  4. Accessing `/research/[listingId]/export` from the listing page resolved the listing in Step 1 and skipped checking for existing research cases for that `listingId`, dropping operator decisions and notes.
  5. `withOperatorScenario()` in `DecisionPacketView` ignored `scenario.customOpeningBid` when computing `computeCashToClose()`, leaving acquisition costs unmodeled for buyer-assumed bids.
  6. In `createCase()`, updating an existing case's scenario emitted a duplicate `origin_recorded` event instead of `underwrite_scenario_updated`.
- **Fix**:
  - Rendered the interactive **Underwriting scenario & acquisition model** section on `/research/[caseId]` with a one-click **Sync local model to case** action.
  - Forwarded scenarios into `saveDecision()` and `recheckSource()`.
  - Added `underwrite_scenario_updated` to case history and guarded `origin_recorded` to newly added origins.
  - Added `filters.listingId` support to `listCases()` and hydrated operator decisions on `/research/[listingId]/export`.
  - Added `## Decision details` and `## Saved underwriting assumptions` to `packetToMarkdown()`.
  - Computed cash-to-close against `effectiveOpeningBid` (published or buyer-assumed).

### Defect 3: Assessor Parcel Write-Through Persistence Blocked by Next.js Proxy
- **File**: `src/app/api/listings/[id]/assessor/route.ts`
- **Symptom**: `server/routes/listings.js` gates parcel caching (`listing.assessorParcel`) and parcel key resolution (`listing.parcelKey`) behind `isWorkspaceAuthorized(req)`. Browser requests to `/api/listings/[id]/assessor` from authenticated operators never persisted data back to the listing store.
- **Root Cause**: The Next.js route called bare `proxyPropertyApi(request)` without operator session credentials.
- **Fix**: Updated `GET /api/listings/[id]/assessor` to read `readWorkspaceSession(request)` and attach `{ operatorToken: configuration.credential }` when an operator is signed in, while preserving unprivileged access for anonymous visitors.

### Defect 4: Homepage Conversion Gateway Dropped Active Filters & Violated Color Grammar
- **Files**:
  - `src/lib/discovery-query.ts`
  - `src/components/terminal/interactive-terminal.tsx`
- **Symptoms**:
  1. The conversion gateway card on `#live-feed` linked statically to `/listings` and `/listings?view=map`, dropping all active filters (`searchQuery`, `selectedState`, `selectedSource`, `observedOnly`, `minDealScore`, `minEquity`, `maxOpeningBid`, `propertyType`, `occupancy`, `seniorLienFilter`, `redemptionFilter`, `sortBy`).
  2. Eyebrow text hardcoded `2,130+ LISTINGS` and used `text-go` (violating Color Grammar, which reserves `go` green for live dots and interactive actions).
- **Fix**:
  - Implemented `terminalFiltersToDiscovery(filters, extras)` in `src/lib/discovery-query.ts`.
  - Wired conversion gateway buttons to preserve active filters.
  - Formatted dynamic inventory count and restyled eyebrow to `text-ink-2`.

### Defect 5: State Code Lowercasing Drift in Hunt Promotion
- **File**: `src/lib/saved-searches.ts`
- **Symptom**: `buildHuntFromSavedSearch()` lowercased state codes (`search.state.toLowerCase()`), causing promoted hunts to store `"oh"`, whereas discovery query matchers and `SavedHunts` badges strictly expect uppercase USPS codes (`"OH"`).
- **Fix**: Normalized state codes to uppercase (`search.state.trim().toUpperCase()`) and sanitized multi-state arrays.

---

## 2. Automated Regression Control Suite

We authored `test/underwriting-case-bridge.test.mjs` covering:
1. `terminalFiltersToDiscovery`: Full filter mapping and clean default URLs.
2. `buildHuntFromSavedSearch`: Uppercase state normalization.
3. `createCase` & `listCases`: Underwriting scenario persistence, `underwrite_scenario_updated` event emission, duplicate origin prevention, and `listingId` query filtering.
4. `buildPacket` & `packetToMarkdown`: Scenario inclusion and formatted decision/assumptions markdown output.
5. `computeCashToClose`: Acquisition model computation on buyer-assumed opening bids.

---

## 3. Verification Receipts

- **`node --test test/underwriting-case-bridge.test.mjs`**: 5/5 passed (118ms)
- **`node --test test/test-wiring.test.js`**: 4/4 passed (79ms)
- **`npm run test:canonical`**: 48/48 passed (795ms)
- **`npm run test:sources`**: 598/598 passed (34.7s)
- **`npm run test:production-e2e`**: 25/25 checks passed (15.5s)
- **`node scripts/release-gate.js`**: 9/9 gates passed (`typecheck`, `generated-context`, `schema-mirrors`, `test-wiring`, `ops-suites`, `scraper-parser`, `production-smoke`, `next-build`, `production-e2e`)
