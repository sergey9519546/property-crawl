# AUDIT_CHECKLIST.md — PerfectProperty Build Audit & Remediation Master Plan
> **Generated**: 2026-11-12
> **Auditors**: Antigravity Deep Audit Engine & Specialist Swarm
> **Architecture & Standard**: Zero-Fabrication Underwriting ($0 Liability Moat, No Synthesized Comps, No Cold Outreach)
> **Full Report Artifact**: `C:\Users\serge\.gemini\antigravity\brain\559f4bf4-b27c-42d3-928b-456f757c0ae8\system_audit_and_remediation_master_checklist.md`

## 1. Executive Summary & Ground Truth
- **Live Production URL**: `https://property-crawl.onrender.com`
- **Live Release Commit**: `646f0b24a5148081051a27e89de9df038bbad68b` (Local is at `0f52d2b`, 2 commits ahead).
- **Persistent Database**: PostgreSQL 17.11 on Supabase (us-west-2, project `icxjpoudcwqfsobaohjz`).
- **Render Free-Tier PG**: `dpg-dbbc8su7bikc73819uo0-a` retirement date is **2026-11-19**. Production traffic is 100% routed to Supabase.
- **Inventory Metrics**: 17,750 total listings; 2,988 fresh (16.8%); 14,762 past cadence.
- **Scraper Status**: 0 in fault; 2 challenge-gated (`LandBankSearchScraper`, `Bid4AssetsScraper`); 4 federal collectors operating at 100% yield (`treasury`, `gsa`, `irs`, `usda`).

## 2. Persistent Requirements Matrix

| ID | Surface | Path | Status | Dependencies | Failure Mode / Residual Risk | Testable Acceptance Criteria |
|---|---|---|---|---|---|---|
| **UI-01** | Discovery Workbench | `src/components/listings/discovery-workbench.tsx` | COMPLETE | `/api/listings`, `triage-bands.ts` | Filter state desync on rapid facet toggling | `test/discovery-workbench-chips.test.mjs`, Playwright grid checks pass |
| **UI-02** | Bidding Simulator | `src/components/terminal/bidding-simulator.tsx` | COMPLETE | `underwrite-scenario.ts`, `underwriting.ts` | Missing valuation causes MAO calculation failure | Renders Bid Cost Model with opening bid; withholds MAO with honest notice; persists in `sessionStorage` |
| **UI-03** | Statutory Carry | `src/components/terminal/statutory-deadlines-timeline.tsx` | COMPLETE | `src/lib/underwriting.ts` | State statutory presets missing for non-priority states | Renders timeline with redemption days, upset bid periods, and carry costs for FL, NJ, OH, CA, TX, NC |
| **UI-04** | Notice Review Split-Pane | `src/components/workspace/review-split-pane.tsx` | PARTIAL | `/api/document-review`, `notice-parser.js` | Irregular OCR whitespace / line breaks offset character span badges | Exact match works; multi-space / non-breaking space normalization fallback needed |
| **UI-05** | Portfolio Pipeline Kanban | `src/components/portfolio/portfolio-view.tsx` | COMPLETE | `portfolio/portfolio-view.tsx`, `localStorage` | Empty state lacking navigation to discovery | Displays 6 pipeline stages; provides interactive stage progression; renders empty state with browse CTA |
| **UI-06** | Activity Board | `src/components/activity/activity-board.tsx` | COMPLETE | `/api/source-network/jobs` | Anonymous access failure without unlock notice | Gated with `PrivateWorkspaceGate`; renders empty state with link to `/sources` |
| **UI-07** | Discovery Map | `src/components/listings/discovery-map.tsx` | COMPLETE | MapLibre GL, `/api/listings` | Map container height collapse or tile latency | Passes `test/heavy-map-deferred.test.mjs` and Playwright map initialization |
| **UI-08** | 50-State Statutory Hub | `src/app/states/page.tsx`, `src/app/states/[code]/page.tsx` | COMPLETE | `src/data/states.ts` | Missing upset bid window or deed type | 50 states render accurate deed types (Sheriff Deed, Trustee Deed, Certificate of Title) |
| **UI-09** | Programmatic SEO Hubs | `/foreclosure`, `/sheriff-sales` | COMPLETE | `src/app/sitemap.ts`, `robots.ts` | Title tag length exceeds SERP pixel limit | SERP titles clamped 40–55 chars; meta tags and OpenGraph configured |
| **BK-01** | Scheduler Pagination Sweep | `server/scrapers/scheduler.js` | PARTIAL | Publisher endpoints, `discoveryStore` | High catalog volume outpaces default sweep budget; 14,762 stale listings | Increase pagination budget and tune sweep intervals for `servicelink`, `civilview`, `hud`, `sheriff` |
| **BK-02** | Email Notice Pipeline | `server/scrapers/email-intake.js`, `scripts/collect-email-notices.js` | COMPLETE | IMAP feed, Gemini/LLM notice parser | Low-confidence notices published without review | Auto-accepts high-confidence verbatim spans; routes ambiguous notices to `document_reviews` |
| **BK-03** | Stale-While-Revalidate Engine | `server/server.js`, Migration 032 | COMPLETE (Ready to Push) | PostgreSQL connection pool | Cold health checks timeout over WAN pooler (>10s) | `/api/health` responds in <10ms via background cache and indexed `idx_listings_source_key_observed` |
| **BK-04** | County & Recorder Adapters | `server/scrapers/` (`cook`, `miami-dade`, `gsa-auctions`) | PARTIAL | County portal access | Blocked by robots.txt (Maricopa) or raster PDF (Harris) | Cook County and Miami-Dade pass local controls; live canary qualification runs ready |
| **BK-05** | Title Risk & Joinder Engine | `server/intelligence/title-risk-engine.js` | COMPLETE | Statutory rule matrix | Failure to detect unserved second mortgage or HOA super-lien | 14 adversarial docket scenarios detect stay violations, junior wiped liens, and redemption holds |
| **INF-01** | Supabase PG 17 Continuity | Supabase Project `icxjpoudcwqfsobaohjz` | COMPLETE | Supabase connection string | Reconnection failure on pooler failover | 17,750 listings and 12,975 compacted observations verified live |
| **INF-02** | Render PG Decommission | Render Instance `dpg-dbbc8su7bikc73819uo0-a` | PARTIAL | Render dashboard / credentials | Expiring free tier on 2026-11-19 causes billing or failure if referenced | Verify zero environment variables reference Render DB; safely delete instance before 2026-11-19 |
| **INF-03** | Hosted Evidence Durability | Render Web Service Persistent Disk | PARTIAL | Render service configuration | Ephemeral filesystem wipes `.cache/snapshots` on deploy | Mount persistent volume at `/var/data` or configure external S3/Supabase storage sync |

## 3. Phased Remediation Roadmap
1. **Phase 1: Production Deployment**: Push commit `0f52d2b` to `origin/main` and verify live Render release.
2. **Phase 2: Scraper Cadence & Sweep Tuning**: Execute continuation sweeps for `servicelink`, `civilview`, `hud`, and `sheriff` to raise fresh listings >75%.
3. **Phase 3: OCR Span Normalization**: Add whitespace and CRLF normalization to `resolveVerbatimSpan` in `review-split-pane.tsx`.
4. **Phase 4: Render PostgreSQL Decommission**: Clean up Render database credentials ahead of Nov 19 deadline.
5. **Phase 5: County Recorder Live Canary Qualification**: Run live canaries for Cook County, Miami-Dade, and GSA API v2.
