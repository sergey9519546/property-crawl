# Source coverage catalog

`server/sources/catalog.js` is the machine-readable source catalog. It has 47
named sources and workflow families. It is a coverage plan, not a claim that a
site is live, contains inventory, or can be collected without authorization.
Runtime health must come from scheduler telemetry and source-observed listing
records.

## What is covered

| Coverage area | Catalog entries | Operating model |
| --- | --- | --- |
| Federal/GSE/failed-institution REO | HUD, HomePath, HomeSteps, USDA, VA/VRM, FDIC, NCUA | Publisher search, licensed/broker workflow where required |
| Federal seized/surplus/land | IRS, Treasury, CWS, GSA, USMS, RealLook, BLM | Exact agency or designated-contractor record; low-volume notices are checked on cadence |
| Foreclosure, sheriff, trustee and tax | Public Auction Network, CivilView, Bid4Assets, Ohio Sheriff Sale, Harris County, Maricopa, county templates, RealAuction | Enroll the statutory county issuer before any adapter is enabled |
| Land banks and local/state surplus | Land Bank Search, Cuyahoga Land Bank, county/municipal, state land, state surplus | Direct owner inventory and jurisdiction-specific application/bid terms |
| Marketplaces | Auction.com, Hubzu, Xome, GovDeals, MLS/broker-authorized feed | Preserve seller/issuer provenance; a marketplace page alone is not title evidence |
| Official parcel and area lookups | Florida Statewide Cadastral, Census ACS, restricted HUD/USPS | Scoped parcel matching; area context stays separate from property facts |
| Early signals and evidence | Federal Register, local notices, PACER, state courts, assessor, recorder, GIS, zoning, FEMA, EPA, USFWS | Leads and due-diligence evidence only; never silently converted into a sale listing |

There is no universal U.S. endpoint for county foreclosures, tax liens/deeds,
trustee notices, land banks, municipal surplus, records, or zoning. The
`jurisdiction` catalog entries are deliberate enrollment templates: select a
county/state, validate its official HTTPS publisher, document sale rules, then
enable a narrowly-scoped adapter. They must not be represented as nationwide
coverage.

## Current adapter boundary

The scheduler currently contains only these adapters:

`bid4assets`, `civilview`, `fannie`, `freddie`, `gsa`, `hud`, `irs`,
`landbank`, `marshals`, `sheriff`, `treasury`, `usda`, and `va`.

The catalog uses `adapterKey: null` for all other sources. In particular,
FDIC is documented for current-offering workflow but is not in the scheduler;
the existing FDIC collector is historical/fixture-oriented. Trustee sales are
also a jurisdiction-enrollment workflow, not a universal adapter.

## Evidence rules

An opportunity record needs an exact publisher record, an observation time, and
the current sale/offer terms. Add the issuer’s notice for a platform listing.
For parcel work, capture an APN or legal description and the official source
URL. Recorder and court records support diligence but do not establish
insurable title, lien priority, occupancy, condition, or bid value.

Public notices, PACER, Federal Register results, FEMA maps, EPA records, and
wetlands maps are leads or screening evidence. They cannot create a live
property listing on their own.

## Enrollment guardrail

`validateJurisdictionDiscoveryUrl()` only validates an administrator-entered
discovery URL. It requires HTTPS and rejects local/private hosts, credentials,
non-default ports, and fragments. It never resolves or fetches a submitted
URL. A later administrative workflow must still verify the government issuer,
scope, legal process, site terms, and record URL shape before enabling a
collector.

## Primary references checked 2026-09-05

- [USAGov government real-estate sales guide](https://www.usa.gov/real-estate-sales)
  identifies HUD, USDA, Fannie, FDIC, GSA, Treasury, and USMS channels.
- [U.S. Marshals Asset Forfeiture](https://www.usmarshals.gov/what-we-do/asset-forfeiture)
  explains its broker/RealLook disposition model.
- [FDIC Asset Sales](https://www.fdic.gov/asset-sales) and its
  [Bargain Properties page](https://www.fdic.gov/asset-sales/bargain-properties)
  distinguish current offerings from historical sales.
- [NCUA loan sales and available real estate](https://ncua.gov/support-services/conservatorships-liquidations/loan-sales-available-real-estate)
  describes its qualified-bidder, confidentiality, and sale process.
- [BLM federal public land sales FAQ](https://www.blm.gov/programs/lands-and-realty/sales-and-exchanges/federal-public-land-sales-faqs)
  says BLM sales are occasional, local, and generally undeveloped land.
- [PACER guidance from the U.S. Courts](https://www.uscourts.gov/court-records/find-a-case-pacer)
  describes account access, court coverage, and the case locator.
- [Harris County Tax Sale](https://www.hctax.net/Property/TaxSales) and
  [Maricopa County Tax-Deeded Land Sales](https://www.maricopa.gov/780/Tax-Deeded-Land-Sales)
  anchor two concrete county workflows.
- [FEMA Map Service Center](https://msc.fema.gov/portal/home),
  [EPA Envirofacts](https://www.epa.gov/enviro), and
  [USFWS Wetlands Mapper](https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper)
  are supporting diligence sources, with their documented limits.
