# COHERENCE.md — Architectural & Logic Coherence Register

> Register of all discovered contradictions, mismatches, and logic gaps in `PROPERTY_CRAWL`.
> Every finding follows the strict evidence-based contradiction format.

---

### [F01] [RESOLVED] High Severity — Anonymous-to-Authenticated Saved Deals Overwrite
- **Evidence**:
  - Anonymous storage branch: `app.js:119-120` reads from `localStorage.getItem('pc_saved')`.
  - Sign-in flow: `app.js:170-179` calls `puter.auth.signIn()`, sets `user`, and immediately invokes `loadSaved()`.
  - Authenticated storage branch: `app.js:115-117` previously wiped local `saved` on sign-in.
- **Concrete Scenario**:
  An anonymous user discovers the site, bookmarks 3 distressed properties to watch, and decides to create/log into their Puter account to enable cloud sync. Upon signing in, `puter.kv.get('pc_saved')` returns `null` or empty. `saved` was overwritten, and the 3 properties the user just saved vanished from their Alerts screen.
- **Resolution**:
  Updated `loadSaved()` to merge the local `saved` set with the cloud `saved` set, persist the union to `puter.kv`, and update the UI.
- **Verification Output**:
  ```
  [Suite 5: Saved Deals Merge on Sign-In]
    ✓ app.js loadSaved merges anonymous local bookmarks with cloud items
  ```

---

### [F02] [RESOLVED] Medium Severity — Deal Score Worked Example Math Drift
- **Evidence**:
  - `index.html:303` and `app.js:693` hardcoded Deal Score `78` for Columbus OH ($52,000 opening bid, $128,500 value midpoint).
  - `data.js:58, 220` computes `Math.round((1 - (52000/128500)) * 130) = 77` for the identical Columbus listing (`OH-FRA-33120`).
- **Concrete Scenario**:
  User reads the Deal Score help modal from the top bar (showing score 78 for Columbus), opens the Columbus listing card, clicks its score help badge, and sees score 77 for the same numbers.
- **Resolution**:
  Standardized worked example score to `77` in both `index.html` and `app.js`.
- **Verification Output**:
  ```
  [Suite 2: Deal Score Formula & Worked Example]
    ✓ Deal Score formula calculates correctly for Columbus OH example (52000, 128500)
    ✓ app.js SCORE_EXAMPLE_PLACEHOLDER score matches formula (77)
    ✓ index.html worked example markup displays score 77
  ```

---

### [F03] [RESOLVED] Low Severity — Truncated PWA Metadata
- **Evidence**:
  - `manifest.json:11`: `"short_name": "PROPERTY_CRA"`.
  - `index.html:64`: `<meta name="apple-mobile-web-app-title" content="PROPERTY_CRA">`.
- **Concrete Scenario**:
  When adding the web app to a mobile home screen, the app icon label was truncated to "PROPERTY_CRA".
- **Resolution**:
  Updated all PWA short name references to `"PROPERTY_CRAWL"`.
- **Verification Output**:
  ```
  [Suite 1: PWA & Metadata]
    ✓ manifest.json short_name is not truncated to PROPERTY_CRA
    ✓ index.html apple-mobile-web-app-title is not truncated to PROPERTY_CRA
  ```

---

### [F04] [RESOLVED] Low Severity — Time-of-Day Countdown Jitter in `daysUntil`
- **Evidence**:
  - `app.js:76-80` used `Math.ceil((dt - new Date()) / 86400000)` where `new Date()` contained arbitrary hour/minute offsets while `dt` was midnight.
- **Concrete Scenario**:
  At 12:05 AM, a sale scheduled for today yielded `-0.003 days`, which with `Math.ceil` produced `-0`, causing inconsistent label transitions and badge colors.
- **Resolution**:
  Normalized both `dt` and `now` to `00:00:00` using `setHours(0,0,0,0)` prior to computing day differences.
- **Verification Output**:
  ```
  [Suite 3: Date Countdown Calculation]
    ✓ app.js daysUntil implementation uses midnight normalization
  ```

---

### [F05] [RESOLVED] Low Severity — Leaflet Map Resize Invalidation
- **Evidence**:
  - `app.js:357-363` initialized Leaflet map without viewport resize listeners.
- **Concrete Scenario**:
  Resizing the window or rotating a tablet caused map tiles to appear grey or clipped until the map was clicked/dragged.
- **Resolution**:
  Registered `window.addEventListener('resize', () => map && map.invalidateSize())`.
- **Verification Output**:
  ```
  [Suite 4: Leaflet Map Setup]
    ✓ app.js registers window resize listener for map invalidation
  ```
