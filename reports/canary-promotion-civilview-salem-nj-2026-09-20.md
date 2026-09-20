# Migration 014 promotion — CivilView Salem County NJ (2026-09-20)

Policy-clean canaries: **declared single-county scope**, no CAPTCHA bypass,
no nationwide claims.

## Declared scope / env

| Knob | Value |
|---|---|
| `CIVILVIEW_TARGET_STATE` | `NJ` |
| `CIVILVIEW_COUNTY_ID` | `20` (Salem County, NJ) |
| `CIVILVIEW_EXTRA_COUNTIES` | *(empty)* |
| `CIVILVIEW_MAX_COUNTIES` | `1` |
| `CIVILVIEW_NATIONWIDE` | `0` |

CivilView `complete` requires `countyId` set, one county attempted, 0 failures,
0 rejected, 0 unattempted summaries — otherwise `truncated` (gate held).

## Result

| Source | State | Clean canaries | Distinct run IDs | Scope |
|---|---|---:|---:|---|
| **civilview** | **promoted** | 2 | 2 | NJ / countyId=20 Salem; 19 accepted / 0 rejected each run |

## Commands

```powershell
$env:DATABASE_URL='postgres://property:property-local-dev@127.0.0.1:55432/property_crawl'
$env:DISCOVERY_MODE='advanced'
$env:CIVILVIEW_TARGET_STATE='NJ'
$env:CIVILVIEW_COUNTY_ID='20'
$env:CIVILVIEW_EXTRA_COUNTIES=''
$env:CIVILVIEW_MAX_COUNTIES='1'
$env:CIVILVIEW_NATIONWIDE='0'
node scripts/canary-live.js run --sources civilview --repeat 2
node scripts/canary-live.js promote --source civilview
```

## Policy

- CAPTCHA publishers (Bid4Assets / Land Bank / CA Controller) remain **unpromoted**.
- Additional CivilView counties need **their own** scope hash + two clean canaries.
