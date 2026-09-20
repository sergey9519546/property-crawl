# Migration 014 promotion — CivilView Hudson County NJ (2026-09-20)

Policy-clean **declared county scope**. No CAPTCHA bypass.

## Scope (promoted)

| Knob | Value |
|---|---|
| `CIVILVIEW_TARGET_STATE` | `NJ` |
| `CIVILVIEW_COUNTY_ID` | `10` (Hudson County) |
| `CIVILVIEW_MAX_COUNTIES` | `1` |
| `CIVILVIEW_DETAIL_LIMIT` | `200` |

Two CLEAN runs: **68 accepted / 0 rejected** each (full detail sweep of 68 summaries).

## Notes

- Default `CIVILVIEW_DETAIL_LIMIT=60` truncates larger counties (Hudson 68 summaries → NOT_CLEAN until budget raised).
- Multi-county `complete` used to require `countiesAttempted === 1`; fixed to compare against **expected** county count.
- Combined Hudson+Salem enrollment hit host **free-space reserve** mid-run — not promoted; disk cleanup needed on this machine (~0.5 GB free).
- Previous Salem-only promotion remains valid historically; **current rollout scope is Hudson countyId=10**.

## CAPTCHA policy unchanged

Bid4Assets / Land Bank / CA Controller remain unpromoted.
