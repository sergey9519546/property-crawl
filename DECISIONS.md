# DECISIONS.md — Architectural Decisions & Rationale

> Log of architectural decisions, tradeoffs, and design resolutions in `PROPERTY_CRAWL`.

---

## D1: Saved Deals Synchronization Model (F01)
- **Problem**: When an anonymous user saves listings in `localStorage` and subsequently signs in to Puter, loading cloud storage should not wipe out their local session.
- **Decision**: Perform a union merge: `saved = new Set([...saved, ...(cloudItems || [])])`. Immediately write the merged set back to `puter.kv` so the cloud account contains the combined set of saved listings.
- **Tradeoff**: If a user logs into a different account, local deals are merged into that account rather than discarded. This is the standard behavior in modern web apps (e.g. merging guest shopping carts / favorites on login).

---

## D2: Deal Score Range & Formula (F02)
- **Problem**: Need an intuitive 0–100 score indicating discount depth while avoiding confusion with 0 (broken) and 100 (unrealistic perfection).
- **Decision**: Formula `dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)))`.
  - Multiplier 130 maps a 50% discount (`ratio = 0.50`) to score `65` (Strong), and a 20% discount (`ratio = 0.80`) to score `26` (Thin).
  - Clamping to `1–99` prevents division anomalies.
- **Tradeoff**: Score is explicitly a triage indicator of opening price spread, not an appraisal. The UI highlights that back taxes, liens, and repairs must be verified by the user.

---

## D3: Zero-Build Static PWA Architecture
- **Decision**: Keep application strictly static (no bundler, no node runtime needed to deploy).
  - Use vendored Leaflet and Lucide UMD bundles.
  - Rely on native ES Modules and browser web standards.
- **Tradeoff**: Zero build setup or dependency maintenance overhead for hosting anywhere (GitHub Pages, Netlify, Cloudflare Pages, S3).
