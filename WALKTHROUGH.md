# WALKTHROUGH.md — Fresh-Eyes Product & Codebase Verification

> Comprehensive walkthrough of `PROPERTY_CRAWL` executed from both a new user's perspective and a new engineer's architectural review.

---

## 1. User Journey Walkthrough

### Journey 1: Discovery & Filtering
1. **Landing & Orientation**:
   - The landing page presents clear product framing: *"Zillow for distressed and government-sold property"*.
   - Live summary stats in the Hero accurately reflect the registry: **20 listings**, **$2.7M in total equity spread**, across **9 states** and **11 verified auction sources**.
2. **Interactive Triage**:
   - Searching for `"Cleveland"` filters the dashboard and Leaflet map down to 2 matching properties (`OH-CUY-10231` on E 55th St and `OH-FRA-33120` on Cleveland Ave).
   - Selecting the `"HUD Home"` chip isolates HUD properties; selecting `"All sources"` restores the full dataset.
   - Changing sort dropdown to `"Soonest sale date"` correctly orders properties chronologically.

### Journey 2: Property Detail & AI Deal Analysis
1. **Detail Drawer**:
   - Clicking property card `OH-CUY-10231` opens the slide-in drawer.
   - Background scrolling is disabled and focus is trapped inside the drawer.
   - Original published legal notice is neatly collapsed in `<details>`.
2. **AI Catch Assessment**:
   - AI deal analysis activates, reading legal text and presenting a candid 2-paragraph evaluation of risks (deposit deadlines, probate/estate confirmations, occupancy status).
   - Clicking `"Re-run"` invalidates the local cache and re-queries the AI model.
3. **Score Explanation**:
   - Clicking the score badge opens the Deal Score modal with the exact calculations matching the listing ($38,000 opening bid / $83,000 midpoint = 46% ratio $\rightarrow$ Deal Score 70 / Strong).

### Journey 3: Bookmarking & Alerts Management
1. **Saving Deals**:
   - Clicking the bookmark icon triggers a bottom toast notification (`"Saved — watching for alerts"`), and updates the header alert badge count.
2. **Alerts Modal**:
   - Clicking `#alertsBtn` opens the saved deals modal, ordering saved properties by urgency.
   - Any stale/removed listings trigger the clean-up banner with one-click removal.
3. **Authentication Merge**:
   - Signing into Puter seamlessly merges locally saved bookmarks into the user's cloud account.

### Journey 4: Legal Notice AI Parser
1. **Notice Extraction**:
   - Clicking `"Load a sample notice"` in the `#parser` section populates the textarea with a real Middlesex County Sheriff sale notice.
   - Clicking `"Parse with AI"` extracts structured attributes across 16 fields (`property_address`, `judgment_amount`, `deposit_terms`, `redemption_note`, etc.).
   - Clicking `"Copy JSON"` copies the formatted output to clipboard for external tracking.

---

## 2. Engineer Code Path Trace

1. **`app.js` Pipeline**:
   - Single, unpolluted data flow: `LISTINGS` $\rightarrow$ `applyFilters` $\rightarrow$ `applySort` $\rightarrow$ `render` (DOM Grid + Leaflet Layers).
   - Pure functional transformations without global state side-effects in comparison functions.
2. **Single Source of Truth (`SCORE_BANDS`)**:
   - Colors, labels, and alpha transparency values for scores 1–99 are derived exclusively from `SCORE_BANDS` (`app.js:96-103`).
3. **DOM Security & XSS Invariant**:
   - All AI output and notice texts are strictly sanitized via `esc()` and structured markdown parsing in `mdToHtml()`.
4. **Resilience & Offline Capabilities**:
   - Offline-capable PWA with local fallback storage, self-hosted vendor assets (`vendor/leaflet/`, `vendor/lucide/`), and Leaflet auto-resizing.

---

## 3. Test Suite Verification

```text
--- STARTING TDD TEST SUITE ---

[Suite 1: PWA & Metadata]
  ✓ manifest.json short_name is not truncated to PROPERTY_CRA
  ✓ index.html apple-mobile-web-app-title is not truncated to PROPERTY_CRA

[Suite 2: Deal Score Formula & Worked Example]
  ✓ Deal Score formula calculates correctly for Columbus OH example (52000, 128500)
  ✓ app.js SCORE_EXAMPLE_PLACEHOLDER score matches formula (77)
  ✓ index.html worked example markup displays score 77

[Suite 3: Date Countdown Calculation]
  ✓ app.js daysUntil implementation uses midnight normalization

[Suite 4: Leaflet Map Setup]
  ✓ app.js registers window resize listener for map invalidation

[Suite 5: Saved Deals Merge on Sign-In]
  ✓ app.js loadSaved merges anonymous local bookmarks with cloud items

--- TEST SUMMARY: 8 Passed, 0 Failed ---
```
