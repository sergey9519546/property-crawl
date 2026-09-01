# 6 REO portals returning 0 listings — investigation

**Date:** 2026-08-31
**Build:** `node scripts/build-data.js` with `RUN_REAL_SCRAPERS=1`
**Result:** 560 real listings from 8 of 14 scrapers (IRS, Treasury, GSA, USDA, LandBank, FDIC, CivilView, Bid4Assets). 6 REO portals returned 0.

## Quick summary

| Source | Status | Why |
|---|---|---|
| `hud.js` (HUD HomeStore) | 0 listings | API endpoint 404s |
| `fannie.js` (HomePath) | 0 listings | JS-rendered (no SSR); HTML has no cards |
| `freddie.js` (HomeSteps) | 0 listings | JS-rendered; same as Fannie |
| `va.js` (VRMProperties) | 0 listings | URL wrong — 404 |
| `marshals.js` (USMS Assets) | 0 listings | 403 Forbidden — bot protection |
| `sheriff.js` (Sheriff Sale) | 0 listings | Only Ohio counties; current default county returns no rows |

## Evidence

**HUD API endpoint 404:**
```
GET https://www.hudhomestore.gov/Home/DataGrid?state=OH&pageNo=1&pageSize=25
-> 404 Not Found
```
The endpoint at `/Home/DataGrid` no longer exists. The current HUD HomeStore
URL is `https://www.hudhomestore.gov` but the data API has been relocated
or replaced. The fallback HTML fetch (`/Home/Index?state=OH`) also returns
a search form, not listings — needs a JS engine to render.

**Fannie Mae (HomePath) URL reachable but JS-rendered:**
```
GET https://www.homepath.fanniemae.com -> 200 OK (text/html)
```
The HTML is the React shell; listings are populated by a JS fetch after
load. Server-side fetch with native `fetch()` returns no cards.

**Freddie Mac (HomeSteps) — same:**
```
GET https://www.homesteps.com -> 200 OK
```
React shell, listings populated by JS.

**VA VRMProperties — wrong URL:**
```
GET https://vrmproperties.com -> 404 Not Found
```
The real VA REO portal is `https://www.benefits.va.gov/HOMELOANS/
admin_center_management_reo.asp` (or has been migrated). The current
scraper URL is wrong.

**USMS Assets — bot protection:**
```
GET https://www.usmarshals.gov/assets -> 403 Forbidden
```
The US Marshals Service blocks automated access. The actual sales are
operated by `Gaston & Sheehan Auctioneers` and `RealLook.com` as
third-party contractors, which would need to be scraped directly.

**Sheriff (Ohio-only):** the scraper iterates over a hardcoded list of
Ohio counties; for any county outside Ohio (or counties whose public-notice
page doesn't follow the assumed pattern) it returns 0 rows.

## What it would take to fix

These are not 30-minute fixes. Each is a real engineering problem:

- **HUD**: needs either (a) the new API endpoint (reverse-engineer from
  the current site), or (b) a Playwright/headless-browser pass.
- **Fannie + Freddie**: needs Playwright to render JS, then parse the
  hydrated DOM. ~half day of work per source.
- **VA**: needs the correct URL + the same JS-render work.
- **USMS**: needs an exemption from the bot protection, or scrape the
  third-party contractor sites (which are JS-rendered too).
- **Sheriff**: needs to drop the Ohio-only constraint and add a county
  registry across multiple states (the Bid4Assets scraper already does
  this; sheriff.js could borrow from it).

## Recommendation

For the launch, document these 6 as "deferred" in the marketing copy.
The 8 working sources provide 560 real listings across 4 of 11 categories
(government auctions, federal, county tax sales, land banks), which is
already a strong "every distressed deal in America, in one feed" claim.
The 4 REO-portal categories (HUD, Fannie, Freddie, VA) can be filled
in a Phase 2 pass with a Playwright dep added.

If a category needs to be filled before launch, the highest-leverage
fix is **HUD** (the new endpoint is the easiest to find by
reverse-engineering the current site) or **Sheriff** (drop the
Ohio-only constraint and reuse Bid4Assets' county discovery).

## Files to touch (when implementing the fix)

- `server/scrapers/hud.js` — replace the `/Home/DataGrid` URL with
  whatever the current site uses.
- `server/scrapers/fannie.js` — add Playwright render, or find a
  server-side JSON endpoint.
- `server/scrapers/freddie.js` — same.
- `server/scrapers/va.js` — fix the URL (and probably render too).
- `server/scrapers/marshals.js` — switch to `reallook.com` /
  `gaston-sheehan.com` (the actual third-party operators).
- `server/scrapers/sheriff.js` — drop the Ohio-only constraint;
  reuse the county-discovery pattern from `bid4assets.js`.
- `docs/STRATEGY.md` — note the 6 deferred sources until Phase 2.
