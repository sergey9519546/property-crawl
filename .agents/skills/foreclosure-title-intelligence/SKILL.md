---
name: foreclosure-title-intelligence
description: |
  Specialized skill for real estate auction underwriting, title risk arbitration,
  junior lien survival analysis, 50-state statutory redemption periods, and cash-to-close fee schedules.
license: MIT
metadata:
  version: v1
  domain: real-estate-intelligence
---

# Foreclosure Title Intelligence & Risk Underwriting Skill

Use this skill when analyzing distressed properties, sheriff sales, tax deeds, and judicial/non-judicial foreclosure notices.

## Core Underwriting Rules

1. **Lien Priority & Survival**:
   - In judicial foreclosure sales, senior liens (1st mortgage recorded prior, superpriority property tax liens, municipal water/sewer liens) survive unless the senior lienholder was explicitly joined and named in the foreclosure suit.
   - When the foreclosing plaintiff is a junior lienholder (2nd mortgage, HELOC, HOA assessment lien), the 1st mortgage survives the sale in full.

2. **Statutory Redemption Periods**:
   - **Alabama**: 180-day statutory redemption under Ala. Code § 6-5-248 (1 year for pre-2016 mortgages).
   - **Michigan**: 6-month statutory redemption under MCL 600.3240 (1 month if abandoned).
   - **New Jersey**: 10-day statutory objection/redemption window under N.J. Ct. R. 4:65-5.
   - **Florida / Ohio**: Terminates at certificate of sale / confirmation of sale.

3. **Complete Cash-to-Close Computation**:
   - Total Cash-to-Close = Opening Bid + Buyer's Premium (5% on marketplaces) + Sheriff Poundage (2–3%) + Transfer Taxes ($1–$4 per $1k) + Delinquent Taxes + Recording Fees.

4. **Multi-Parcel Disambiguation**:
   - Always verify if a single legal advertisement contains multiple distinct tracts, parcels, or lots with independent opening bids.
