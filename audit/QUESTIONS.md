# QUESTIONS.md — System Interrogation & Evidence

> Deep interrogation of every component, invariant, assumption, and lifecycle in `PROPERTY_CRAWL`.
> All answers derived directly from verified codebase evidence.

---

## 1. Authentication & Persistence Lifecycle

### Q1.1: What happens to locally saved deals when an anonymous user logs in?
- **Analysis**:
  - In `app.js:113-124`, `loadSaved()` reads from `localStorage` when `!user` and from `puter.kv.get('pc_saved')` when `user` is set.
  - In `app.js:170-179`, when the user signs in:
    ```javascript
    await puter.auth.signIn();
    user = await puter.auth.getUser();
    await loadSaved(); renderAuth(); render();
    ```
- **Finding / Evidence**:
  - If a user bookmarks 3 deals while anonymous (stored in `localStorage`), and then clicks "Sign In", `loadSaved()` immediately runs with `user` defined and replaces `saved` with `puter.kv.get('pc_saved')`.
  - If the user's cloud account has no saved deals yet (`null`), `saved` is reset to an empty set (`new Set([])`), and the user's previously saved items in `localStorage` are lost/orphaned!
- **Concrete Scenario**:
  A user explores the dashboard, saves 3 properties, sees "3" on the Alerts badge, decides to sign in to "sync across devices", and immediately upon logging in, their 3 saved properties disappear.
- **Evidence-Based Resolution**:
  On sign-in, if local `saved` has items, merge local `saved` into cloud `saved` before persisting to `puter.kv`.

---

## 2. Deal Score Logic & Value Midpoint Modeling

### Q2.1: How does the Deal Score behave on properties where the opening bid equals or exceeds estimated value?
- **Analysis**:
  - In `data.js:213-221`, `mid = (estLow + estHigh) / 2`, `ratio = openingBid / mid`.
  - Score formula: `dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))`.
- **Evidence**:
  - If `ratio >= 1.0` (opening bid >= midpoint), `(1 - ratio) <= 0`.
  - Clamping `Math.max(1, ...)` guarantees that even an overpriced auction will receive a minimum score of `1` (Thin deal), preventing negative numbers or NaN.
  - In `SCORE_BANDS` (`app.js:96-103`), scores 1–34 map to "Thin" (red `#dc2626`).

### Q2.2: Does the worked example in the help modal stay consistent across all entry points?
- **Analysis**:
  - Toolbar "?" help button triggers `openScoreModal(null)`, which loads `SCORE_EXAMPLE_PLACEHOLDER` (`app.js:689-693`).
  - Listing drawer score badge triggers `openScoreModal(l)`, which extracts numbers via `scoreExampleFromListing(l)` (`app.js:694-701`).
- **Evidence**:
  - Both paths share `renderScoreExample(ex)` (`app.js:702-713`) and format with identical label and formula structure `(1 - ratio) * 130 ≈ score`.
  - With the Columbus placeholder score verified at `77`, the calculation is identical across both views.

---

## 3. Search & Filter Composition

### Q3.1: Does the search filter match against dynamically formatted values or raw data?
- **Analysis**:
  - In `app.js:245-248`:
    ```javascript
    const hay = [l.address, l.city, l.county, l.state, l.plaintiff,
                 l.defendant, l.attorney, l.occupancy, l.deposit,
                 SOURCES[l.source].label].join(' ').toLowerCase();
    ```
- **Evidence**:
  - Search matches against all text properties as well as human source labels (e.g. typing "Sheriff" matches all `sheriff` sources because `SOURCES['sheriff'].label` is in `hay`).
  - Search is purely functional, case-insensitive, and composes with `stateFilter`, `typeFilter`, and `activeSources` without race conditions.

---

## 4. UI Focus & Accessibility Boundaries

### Q4.1: Do modals and drawers release focus properly when dismissed via ESC or backdrop click?
- **Analysis**:
  - In `app.js:22-60`, `trapFocus(container)` saves `_lastFocused = document.activeElement`.
  - In `closeDrawer()`, `closeAlertsModal()`, `closeScoreModal()`, `shutMenu()`, `releaseFocus()` is invoked, calling `_lastFocused.focus()`.
  - `document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeDrawer(); closeAlertsModal(); closeScoreModal(); shutMenu(); } })` (`app.js:842`).
- **Evidence**:
  - Full keyboard navigability is maintained. When pressing ESC from any modal or drawer, focus returns safely to the triggering button.

---

## 5. Map & Viewport Synchronization

### Q5.1: Does the map properly reflect the currently filtered dataset?
- **Analysis**:
  - In `render()` (`app.js:345-354`), `const arr = getFiltered();` is passed directly to `renderMap(arr)`.
  - `renderMap` clears previous markers (`markerLayer.clearLayers()`), adds circle markers colored by `SOURCES[l.source].color`, and recalculates bounds (`map.fitBounds(pts)`).
  - Popups include listing score, city, source label, and an active click handler (`[data-open="${l.id}"]`) to open the detail drawer directly from the map.
