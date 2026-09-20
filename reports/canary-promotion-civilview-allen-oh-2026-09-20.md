# Migration 014 promotion — CivilView Allen County OH (2026-09-20)

Policy-clean **declared county scope**. No CAPTCHA bypass.

## Scope (current rollout)

| Knob | Value |
|---|---|
| `CIVILVIEW_TARGET_STATE` | `OH` |
| `CIVILVIEW_COUNTY_ID` | `34` (Allen County, OH) |
| `CIVILVIEW_MAX_COUNTIES` | `1` |
| `CIVILVIEW_DETAIL_LIMIT` | `200` |

Two CLEAN runs: **10 accepted / 0 rejected** each (full detail sweep).

## Rollout note

Migration 014 stores **one active scope hash** per source. This promotion
replaces civilview scope from NJ Hudson (`09d4b12adfaa…`) with **OH Allen**.
Prior county evidence remains in reports; rerun canaries if Hudson inventory
must be re-promoted as the active scope.

## CAPTCHA policy unchanged

Bid4Assets / Land Bank / CA Controller remain unpromoted.
