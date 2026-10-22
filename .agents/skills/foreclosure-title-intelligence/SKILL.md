---
name: foreclosure-title-intelligence
description: |
  Specialized skill for real estate auction underwriting, title risk arbitration,
  junior lien survival analysis, 50-state statutory redemption periods, instrument
  priority chronologies, and statutory cash-to-close fee schedules.
license: MIT
metadata:
  version: v2
  domain: real-estate-intelligence
---

# Foreclosure Title Intelligence & Risk Underwriting Skill

Use this skill when analyzing distressed properties, sheriff sales, tax deeds, judicial/non-judicial foreclosure notices, or maintaining the underwriting and title-risk engines (`src/lib/underwriting.ts`, `src/components/terminal/bidding-simulator.tsx`, `server/intelligence/title-risk-engine.js`).

## Core Blueprint Principles & Derived Decision Rules

1. **Zero-Fabrication Underwriting (Fail-Closed Valuation)**:
   - Never fabricate or impute `estLow`, `estHigh`, or ARV from `openingBid` or county tax-assessed values (`src/lib/underwriting.ts` `deriveMaxBidAssumption`).
   - When both `estLow` and `estHigh` are absent or zero, `deriveMaxBidAssumption` must require an explicit buyer-supplied value assumption (`source: 'required'`) rather than inventing a synthetic spread.
   - Never equate `status === 'closed'` with `sold` or `bidsPlaced === 10` with real bid competition (`docs/COMPLETION_CHECKLIST.md`).

2. **Lien Priority, Instrument Chronology & Survival (`server/intelligence/title-risk-engine.js`)**:
   - In judicial foreclosure sales, senior liens (prior-recorded 1st mortgage, super-priority property tax liens, municipal water/sewer/code-enforcement liens) survive unless the senior lienholder was explicitly joined and extinguished.
   - When the foreclosing plaintiff is a junior lienholder (2nd mortgage, HELOC, HOA assessment lien), the 1st mortgage survives the sale in full.
   - **Instrument & Book/Page Chronological Priority (`extractInstrumentPrioritySignals`)**:
     - Parse recorded `Book X, Page Y` (`Official Records Book` / `OR Book` / `Deed Book`) and `Instrument #YYYY-NNNNN` (`Inst #` / `Doc #` / `CFN`) citations in chronological/page order.
     - Detect explicit subordination agreements (`subordinate to`, `subject and subordinate to`, `subordination agreement`) and senior mortgage survival clauses (`subject to prior mortgage`, `first mortgage held by`, `senior lien of`).
     - When multiple instrument citations appear without an explicit subordination waiver, flag earlier-recorded instruments (`survivingSeniorInstruments`) as potential surviving encumbrances requiring title search verification.

3. **State-Specific Statutory Fee Schedules (`computeStatutoryFeePreset` in `src/lib/underwriting.ts`)**:
   - **Florida (`FL`)**: Doc stamps `0.7%` (\$0.70 per \$100 under Fla. Stat. § 201.02) + Clerk registry fee (`3%` on first \$500, `1.5%` on balance under Fla. Stat. § 28.24).
   - **New Jersey (`NJ`)**: Tiered Sheriff's Commission under N.J.S.A. 22A:4-8 (`6%` on first \$5,000, `4%` on next \$5,000, `2%` on balance; approximate blended rate `2.2%`) + NJ Realty Transfer Fee (`~1.0%`).
   - **Ohio (`OH`)**: Sheriff Poundage `1.5%` under ORC § 311.17 + County Conveyance Fee `0.4%` (\$4 per \$1,000 under ORC § 319.54).
   - **Pennsylvania (`PA`)**: Combined state + local Realty Transfer Tax `2.0%` (commonly non-exempt on sheriff deeds) + Sheriff Poundage `2.0%`.
   - **Texas (`TX`)**: `0%` state transfer tax and `0%` sheriff poundage on non-judicial substitute trustee sales (`Tex. Prop. Code § 51.002`).
   - **Marketplace Overlay**: Online portals (`bid4assets`, `servicelink`) add a `5.0%` Buyer's Premium on top of statutory county fees unless waived by the county.

4. **Statutory Redemption Windows, Deposit Deadlines & Capital Carry (`computeStatutoryDeadlinesAndCarry`)**:
   - **Federal IRS Tax Lien Override (26 U.S.C. § 7425(d))**: Whenever an IRS notice of federal tax lien is attached (`hasIrsNoticeFlag`), the United States retains a **120-day** post-sale right of redemption (365 days in specific judicial contexts) that overrides shorter state confirmation windows.
   - **State Redemption & Objection Windows**:
     - **Alabama (`AL`)**: 180-day statutory redemption under Ala. Code § 6-5-248 (1 year for pre-2016 residential mortgages).
     - **Michigan (`MI`)**: 180-day (6-month) statutory redemption under MCL 600.3240 (30 days if determined abandoned).
     - **New Jersey (`NJ`)**: 10-day post-sale objection/redemption window under N.J. Ct. R. 4:65-5 before sheriff's deed delivery; balance due within 30 days (`10%` deposit at gavel).
     - **North Carolina (`NC`)**: 10-day rolling upset bid window under N.C.G.S. § 45-21.27 (`5%` deposit at gavel).
     - **Florida (`FL`) / Ohio (`OH`)**: Redemption terminates upon clerk's Certificate of Sale (`FL`, Fla. Stat. § 45.0315; balance due by next business day, `5%` deposit at gavel) or Court Confirmation of Sale (`OH`, ORC § 2329.33; ~30-day confirmation lag, `10%` deposit at gavel).
   - **Locked Capital Carry Cost**: Compute carry cost over the statutory redemption/confirmation lockup (`Math.round(totalCashNeeded * 0.10 * (effectiveRedemptionDays / 365))`) so bidders account for illiquidity during redemption holds.

5. **Client-Bundle Payload Invariant (`test/list-response-payload.test.mjs`)**:
   - `src/components/terminal/bidding-simulator.tsx` is rendered inside the listing grid (`interactive-terminal.tsx`).
   - The list API (`GET /api/listings`) strips `raw`, `provenance.sourceFields`, and `provenance.statusHistory` from grid payloads.
   - **Never** reference `listing.raw` inside `bidding-simulator.tsx` or any grid-mounted component; derive `hasIrsNoticeFlag` strictly from non-stripped fields (`listing.source === 'irs'`, `listing.seniorLienWarning`, `listing.redemptionWarning`).
