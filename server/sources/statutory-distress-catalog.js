'use strict';

/**
 * High-trust official distress deal sources extracted from
 * Curated statutory distress sources master catalog.
 *
 * Covers:
 * - Official county tax deed auction platforms (RealForeclose, RealTaxDeed) & county tax collectors
 * - Official sheriff civil foreclosure sales and court docket execution notices
 * - Municipal and county land banks (DLBA, Cuyahoga, Cook County, Cleveland)
 * - First-party bank REO property portals (Bank of America, Wells Fargo, US Bank, Regions)
 * - Official county surrogate and probate court case records
 */

const STATUTORY_DISTRESS_CATALOG_ENTRIES = Object.freeze([
  {
    "id": "tax-miamidade-realforeclose",
    "label": "Miami-Dade County FL — Tax Deed Auction (RealForeclose)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Miami-Dade County FL — Tax Deed Auction (RealForeclose) (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.miamidade.realforeclose.com/index.cfm",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Miami-Dade County FL — Tax Deed Auction (RealForeclose) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per F.S. §197.542. Online bidding via Grant Street. Tech: Grant Street platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-broward-realtaxdeed",
    "label": "Broward County FL — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Broward County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://broward.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Broward County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Active listings visible. Monthly auction. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-palmbeach-realtaxdeed",
    "label": "Palm Beach County FL — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Palm Beach County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://palmbeach.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Palm Beach County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Grant Street RealTaxDeed platform. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-orange-realtaxdeed",
    "label": "Orange County FL (Orlando) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Orange County FL (Orlando) — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://orange.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Orange County FL (Orlando) — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Active auction listings. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-hillsborough-realtaxdeed",
    "label": "Hillsborough County FL (Tampa) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Hillsborough County FL (Tampa) — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://hillsborough.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Hillsborough County FL (Tampa) — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Grant Street RealTaxDeed platform. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-lee-realtaxdeed",
    "label": "Lee County FL (Fort Myers) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Lee County FL (Fort Myers) — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.lee.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Lee County FL (Fort Myers) — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Grant Street RealTaxDeed platform. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-pinellas-realtaxdeed",
    "label": "Pinellas County FL (St. Petersburg) — Tax Deed",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Pinellas County FL (St. Petersburg) — Tax Deed (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://pinellas.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Pinellas County FL (St. Petersburg) — Tax Deed for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Grant Street platform. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-duval-realtaxdeed",
    "label": "Duval County FL (Jacksonville) — Tax Deed",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Duval County FL (Jacksonville) — Tax Deed (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://duval.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Duval County FL (Jacksonville) — Tax Deed for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Grant Street platform. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-polk-realtaxdeed",
    "label": "Polk County FL — Tax Deed",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Polk County FL — Tax Deed (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://polk.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Polk County FL — Tax Deed for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed law. Tech: Grant Street platform. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-brevard-realtaxdeed",
    "label": "Brevard County FL (Titusville/Melbourne) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Brevard County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://brevard.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Brevard County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-volusia-realtaxdeed",
    "label": "Volusia County FL (DeLand/Daytona Beach) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Volusia County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://volusia.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Volusia County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-sarasota-realtaxdeed",
    "label": "Sarasota County FL (Sarasota) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Sarasota County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://sarasota.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Sarasota County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-manatee-realtaxdeed",
    "label": "Manatee County FL (Bradenton) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Manatee County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://manatee.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Manatee County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-collier-realtaxdeed",
    "label": "Collier County FL (Naples) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Collier County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://collier.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Collier County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-pasco-realtaxdeed",
    "label": "Pasco County FL (Dade City/New Port Richey) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Pasco County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://pasco.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Pasco County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-marion-realtaxdeed",
    "label": "Marion County FL (Ocala) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Marion County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://marion.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Marion County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-lake-realtaxdeed",
    "label": "Lake County FL (Tavares) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Lake County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://lake.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Lake County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-osceola-realtaxdeed",
    "label": "Osceola County FL (Kissimmee) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Osceola County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://osceola.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Osceola County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-seminole-realtaxdeed",
    "label": "Seminole County FL (Sanford) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Seminole County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://seminole.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Seminole County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-stlucie-realtaxdeed",
    "label": "St. Lucie County FL (Fort Pierce) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "St. Lucie County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://stlucie.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect St. Lucie County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-escambia-realtaxdeed",
    "label": "Escambia County FL (Pensacola) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Escambia County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://escambia.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Escambia County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-charlotte-realtaxdeed",
    "label": "Charlotte County FL (Punta Gorda) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Charlotte County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://charlotte.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Charlotte County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-clay-realtaxdeed",
    "label": "Clay County FL (Green Cove Springs) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Clay County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://clay.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Clay County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-citrus-realtaxdeed",
    "label": "Citrus County FL (Inverness) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Citrus County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://citrus.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Citrus County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-hernando-realtaxdeed",
    "label": "Hernando County FL (Brooksville) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Hernando County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://hernando.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Hernando County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-martin-realtaxdeed",
    "label": "Martin County FL (Stuart) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Martin County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://martin.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Martin County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-okaloosa-realtaxdeed",
    "label": "Okaloosa County FL (Crestview/Fort Walton Beach) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Okaloosa County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://okaloosa.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Okaloosa County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-santarosa-realtaxdeed",
    "label": "Santa Rosa County FL (Milton) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Santa Rosa County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://santarosa.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Santa Rosa County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-stjohns-realtaxdeed",
    "label": "St. Johns County FL (St. Augustine) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "St. Johns County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://stjohns.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect St. Johns County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-bay-realtaxdeed",
    "label": "Bay County FL (Panama City) — Tax Deed Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Bay County FL — Tax Deed Auction (county, FL). Official statutory source for tax deed.",
    "discoveryUrl": "https://bay.realtaxdeed.com",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Bay County FL — Tax Deed Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "Florida tax deed sale per Fla. Stat. § 197.542. Tech: RealAuction RealTaxDeed platform. Active auction listings publicly viewable. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-dallas-tx-pubworks",
    "label": "Dallas County TX — Tax Sale Properties",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Dallas County TX — Tax Sale Properties (county, TX). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.dallascounty.org/departments/pubworks/property-division.php",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Dallas County TX — Tax Sale Properties for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TX first Tuesday tax sale. Tech: Live online auction. First Tuesday each month. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-bexar-tx-resale",
    "label": "Bexar County TX (San Antonio) — Resale Properties List",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Bexar County TX (San Antonio) — Resale Properties List (county, TX). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.bexar.org/DocumentCenter/View/41852/Bexar-County-Resale-Properties-Distribution-List?bidId=",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Bexar County TX (San Antonio) — Resale Properties List for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TX first Tuesday tax sale. Linebarger law firm hosts auction. Tech: PDF list. Updated July 7, 2026 (per file metadata). Extraction method: pdf_ocr. Cost: free. API: no."
  },
  {
    "id": "tax-tarrant-tx-constable",
    "label": "Tarrant County TX (Fort Worth) — Delinquent Tax Sales",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Tarrant County TX (Fort Worth) — Delinquent Tax Sales (county, TX). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.tarrantcountytx.gov/en/constables/constable-3/delinquent-tax-sales.html",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Tarrant County TX (Fort Worth) — Delinquent Tax Sales for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TX first Tuesday. Constable P-3 hosts. Tech: Sales results posted by month. Upcoming list posted 21 days prior. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-travis-tx-constable",
    "label": "Travis County TX (Austin) — Tax Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Travis County TX (Austin) — Tax Sale (county, TX). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.traviscountytx.gov/departments/constable/precinct-3/tax-sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Travis County TX (Austin) — Tax Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TX first Tuesday. Per Tex. Tax Code §34.04. Tech: Constable P-3 hosts. PDF list posted 30 days prior. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-fulton-ga-sheriff",
    "label": "Fulton County GA (Atlanta) — Tax Sale (Sheriff)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Fulton County GA (Atlanta) — Tax Sale (Sheriff) (county, GA). Official statutory source for tax deed.",
    "discoveryUrl": "https://fultoncountyga.gov/inside-fulton-county/fulton-county-departments/sheriff/tax-sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Fulton County GA (Atlanta) — Tax Sale (Sheriff) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "First Tuesday of month per O.C.G.A. §48-4-45. 12-month redemption. Tech: Sheriff posts list 30 days prior. Bidder registration required. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-dekalb-ga-publicaccess",
    "label": "DeKalb County GA — Tax Sale Listing Search",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "DeKalb County GA — Tax Sale Listing Search (county, GA). Official statutory source for tax deed.",
    "discoveryUrl": "https://publicaccess.dekalbtax.org/forms/htmlframe.aspx?mode=content/search/tax_sale_listing.html",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect DeKalb County GA — Tax Sale Listing Search for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "First Tuesday GA tax sale. Tech: Searchable property listing. Active auctions. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-cobb-ga-tax",
    "label": "Cobb County GA — Tax Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Cobb County GA — Tax Sale (county, GA). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.cobbtax.gov/property/tax_sale/index.php",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Cobb County GA — Tax Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "First Tuesday GA tax sale. Tech: Tax Commissioner posts list with property details. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-clayton-ga-publicaccess",
    "label": "Clayton County GA — Tax Sale List (PDF)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Clayton County GA — Tax Sale List (PDF) (county, GA). Official statutory source for tax deed.",
    "discoveryUrl": "https://publicaccess.claytoncountyga.gov/content/PDF/AUGUST%202025%20TAX%20SALE%20LISTING.pdf",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Clayton County GA — Tax Sale List (PDF) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "First Tuesday GA tax sale. Tech: Monthly PDF list of tax sale parcels. Extraction method: pdf_ocr. Cost: free. API: no."
  },
  {
    "id": "tax-cuyahoga-oh-cpdocket",
    "label": "Cuyahoga County OH (Cleveland) — Sheriff Foreclosure Sales",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Cuyahoga County OH (Cleveland) — Sheriff Foreclosure Sales (county, OH). Official statutory source for tax deed.",
    "discoveryUrl": "https://cpdocket.cp.cuyahogacounty.gov/SheriffSearch/printresults.aspx?q=searchType%3Ddate_range%26searchString%3D%26foreclosureType%3D%26dateFrom%3D%26dateTo%3D",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Cuyahoga County OH (Cleveland) — Sheriff Foreclosure Sales for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "OH sheriff sale per O.R.C. §2329. Online only via Bid4Assets. Tech: Searchable by date range. Lists all upcoming sales with case#, opening bid, sale date. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-franklin-oh-sheriff",
    "label": "Franklin County OH (Columbus) — Sheriff Real Estate Sales",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Franklin County OH (Columbus) — Sheriff Real Estate Sales (county, OH). Official statutory source for tax deed.",
    "discoveryUrl": "https://sheriff.franklincountyohio.gov/real-estate-sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Franklin County OH (Columbus) — Sheriff Real Estate Sales for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "OH sheriff sale law. Tech: Active property listings with appraisal + opening bid. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-jackson-mo-16thcircuit",
    "label": "Jackson County MO — Delinquent Land Tax Sale (16th Circuit)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Jackson County MO — Delinquent Land Tax Sale (16th Circuit) (county, MO). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.16thcircuit.org/delinquent-land-tax",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Jackson County MO — Delinquent Land Tax Sale (16th Circuit) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MO delinquent land tax sale. 3-year delinquency required. Tech: Search by Suit#, Parcel#, Property Address. Active listings. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-princegeorges-md-portal",
    "label": "Prince George's County MD — Tax Sale Site",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Prince George's County MD — Tax Sale Site (county, MD). Official statutory source for tax deed.",
    "discoveryUrl": "https://taxsale.princegeorgescountymd.gov",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Prince George's County MD — Tax Sale Site for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MD Tax-Property §14-817. 2026 auction active. Tech: Official tax sale website. Property listings with bid instructions. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-baltimore-city-md-taxlien",
    "label": "Baltimore City MD — Tax Lien Certificate Sale Properties",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Baltimore City MD — Tax Lien Certificate Sale Properties (city, MD). Official statutory source for tax deed.",
    "discoveryUrl": "https://data.baltimorecity.gov/maps/baltimore::tax-lien-certificate-sale-properties-2",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Baltimore City MD — Tax Lien Certificate Sale Properties for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MD tax lien law. Annual May sale. Tech: Open data portal. Map-based. Filter by address. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-baltimore-county-md-ad",
    "label": "Baltimore County MD — Tax Sale Properties PDF",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Baltimore County MD — Tax Sale Properties PDF (county, MD). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.baltimorecountymd.gov/files/departments/budget-and-finance/documents/tax-sale-third-ad-2025.pdf",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Baltimore County MD — Tax Sale Properties PDF for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MD tax lien law. Tech: PDF list of all tax-sale properties with addresses + amounts owed. Extraction method: pdf_ocr. Cost: free. API: no."
  },
  {
    "id": "tax-maricopa-az-unsold-inventory",
    "label": "Maricopa County AZ — Unsold Tax-Deeded Land PDF",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Maricopa County AZ — Unsold Tax-Deeded Land PDF (county, AZ). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.maricopa.gov/DocumentCenter/View/2241/Listing-of-Previously-Offered-Tax-Deeded-Land---NOT-SOLD-PDF",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Maricopa County AZ — Unsold Tax-Deeded Land PDF for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "AZ tax deed law. Tech: List of parcels held by state, available for OTC purchase. Extraction method: pdf_ocr. Cost: free. API: no."
  },
  {
    "id": "tax-arapahoe-co-treasurer",
    "label": "Arapahoe County CO — Tax Lien Sale Files",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Arapahoe County CO — Tax Lien Sale Files (county, CO). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.arapahoeco.gov/your_county/county_departments/treasurer/tax_lien_sale/tax_lien_sale_files/index.php",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Arapahoe County CO — Tax Lien Sale Files for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "C.R.S. §39-11. November tax lien auction. Tech: Active listing files published 3 weeks before auction. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-denver-co-delinquent",
    "label": "Denver County CO — Tax Lien Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Denver County CO — Tax Lien Sale (city, CO). Official statutory source for tax deed.",
    "discoveryUrl": "https://denvergov.org/Government/Agencies-Departments-Offices/Agencies-Departments-Offices-Directory/Department-of-Finance/Our-Divisions/Treasury/Property-Taxes/Real-Estate-Delinquent-Taxes-and-Tax-Lien-Sale",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Denver County CO — Tax Lien Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "CO tax lien law. Tech: Annual November sale. Property list published. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-clark-nv-treasurer",
    "label": "Clark County NV (Las Vegas) — Tax Auction Properties",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Clark County NV (Las Vegas) — Tax Auction Properties (county, NV). Official statutory source for tax deed.",
    "discoveryUrl": "https://treasurer.clarkcountynv.gov/auction/Auction/AuctionList",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Clark County NV (Las Vegas) — Tax Auction Properties for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "NRS §361.730. Treasurer auction. Tech: Live auction list with property addresses + minimum bids. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-cook-il-scavenger-sale",
    "label": "Cook County IL (Chicago) — Scavenger Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Cook County IL (Chicago) — Scavenger Sale (county, IL). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.cookcountytreasurer.com/scavengersale.aspx",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Cook County IL (Chicago) — Scavenger Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "35 ILCS 200. Annual scavenger sale. Tech: Excel download of properties. Updated annually. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-wayne-mi-foreclosed-auction",
    "label": "Wayne County MI (Detroit) — Foreclosed Property Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Wayne County MI (Detroit) — Foreclosed Property Auction (county, MI). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.waynecountymi.gov/Government/Elected-Officials/Treasurer/Claims-Auctions",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Wayne County MI (Detroit) — Foreclosed Property Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MCL §211.78. Annual Sep-Oct auction. Minimum bid = taxes owed. Tech: Hosted on Bid4Assets. Property listings with opening bids. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-oakland-mi-treasurer",
    "label": "Oakland County MI — Tax-Foreclosed Property Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Oakland County MI — Tax-Foreclosed Property Auction (county, MI). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.oakgov.com/government/oakland-county-treasurer-s-office/property-taxes/property-tax-foreclosure-surplus-claims",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Oakland County MI — Tax-Foreclosed Property Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MI tax foreclosure law. Tech: Online auction only. Property inventory link. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-macomb-mi-treasurer",
    "label": "Macomb County MI — Tax Foreclosure Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Macomb County MI — Tax Foreclosure Auction (county, MI). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.macombgov.org/departments/treasurers-office/tax-foreclosure/auction-and-claims",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Macomb County MI — Tax Foreclosure Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MI tax foreclosure law. Tech: Auction held 3rd Tue Jul–1st Tue Aug. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-genesee-mi-treasurer",
    "label": "Genesee County MI (Flint) — Tax Sale Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Genesee County MI (Flint) — Tax Sale Auction (county, MI). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.geneseecountymi.gov/departments/treasurer/index.php",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Genesee County MI (Flint) — Tax Sale Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "MI tax foreclosure law. Tech: All auctions online. September auction dates. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-allen-in-treasurer",
    "label": "Allen County IN (Fort Wayne) — Tax Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Allen County IN (Fort Wayne) — Tax Sale (county, IN). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.allencounty.in.gov/270/Tax-Sale",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Allen County IN (Fort Wayne) — Tax Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "IC §6-1.1-24. County auditor tax sale. 1-year redemption. Tech: Annual September tax sale. Property list published. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-grant-in-delinquent-listing",
    "label": "Grant County IN — Delinquent Property Listing",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Grant County IN — Delinquent Property Listing (county, IN). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.in.gov/counties/grant/files/DelinquentPropertyListing2022.pdf",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Grant County IN — Delinquent Property Listing for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "IN tax sale law. Tech: PDF list of delinquent properties eligible for tax sale. Extraction method: pdf_ocr. Cost: free. API: no."
  },
  {
    "id": "tax-mecklenburg-nc-foreclosure",
    "label": "Mecklenburg County NC (Charlotte) — Tax Foreclosure Properties",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Mecklenburg County NC (Charlotte) — Tax Foreclosure Properties (county, NC). Official statutory source for tax deed.",
    "discoveryUrl": "https://tax.mecknc.gov/tax-foreclosure-properties",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Mecklenburg County NC (Charlotte) — Tax Foreclosure Properties for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "G.S. §105-369 + §105-375. Judicial tax foreclosure. Tech: List of properties in active tax foreclosure. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-mecklenburg-nc-delinquent",
    "label": "Mecklenburg County NC — Delinquent Taxpayer Lists",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Mecklenburg County NC — Delinquent Taxpayer Lists (county, NC). Official statutory source for tax deed.",
    "discoveryUrl": "https://tax.mecknc.gov/Delinquent-Taxpayer-Lists",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Mecklenburg County NC — Delinquent Taxpayer Lists for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "NC public records law. Tech: Published lists to notify taxpayers. Subject to enforced collection. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-durham-nc-foreclosure",
    "label": "Durham County NC — Tax Foreclosure Properties",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Durham County NC — Tax Foreclosure Properties (county, NC). Official statutory source for tax deed.",
    "discoveryUrl": "https://dconc.gov/Tax-Administration/Payment-Options-and-Collections/Foreclosure",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Durham County NC — Tax Foreclosure Properties for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "NC tax foreclosure law. Tech: Properties listed for sale under court judgment for failure to pay taxes. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-wake-nc-foreclosure",
    "label": "Wake County NC (Raleigh) — Tax Foreclosures",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Wake County NC (Raleigh) — Tax Foreclosures (county, NC). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.wake.gov/departments-government/tax-administration/real-estate/foreclosures",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Wake County NC (Raleigh) — Tax Foreclosures for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "NC tax foreclosure law. Tech: Properties currently being foreclosed on by tax office. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-durham-nc-arcgis-delinquent",
    "label": "Durham County NC — Tax Delinquent Properties Map (ArcGIS)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Durham County NC — Tax Delinquent Properties Map (ArcGIS) (county, NC). Official statutory source for tax deed.",
    "discoveryUrl": "https://experience.arcgis.com/experience/640b8534655c4397b75f1d5a9cbad201",
    "access": "public",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Durham County NC — Tax Delinquent Properties Map (ArcGIS) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "NC public records law. Tech: ArcGIS Experience Builder. Map of tax-delinquent properties. Extraction method: api. Cost: free. API: yes."
  },
  {
    "id": "tax-shelby-tn-county-sale",
    "label": "Shelby County TN (Memphis) — Tax Sale Information",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Shelby County TN (Memphis) — Tax Sale Information (county, TN). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.shelbycountytn.gov/330/Tax-Sale-Information",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Shelby County TN (Memphis) — Tax Sale Information for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "T.C.A. §67-5-2501. Chancery court jurisdiction. Tech: Chancery Court Clerk & Master's Office conducts public auctions. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-shelby-tn-trustee-sale",
    "label": "Shelby County TN — Trustee Tax Sale Properties",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Shelby County TN — Trustee Tax Sale Properties (county, TN). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.shelbycountytrustee.com/108/Tax-Sale",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Shelby County TN — Trustee Tax Sale Properties for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TN tax sale law. Tech: Properties available for sale, schedule, bidder registration. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-knox-tn-trustee-sale",
    "label": "Knox County TN (Knoxville) — Trustee Tax Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Knox County TN (Knoxville) — Trustee Tax Sale (county, TN). Official statutory source for tax deed.",
    "discoveryUrl": "https://trustee.knoxcounty.org/services/tax-sale",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Knox County TN (Knoxville) — Trustee Tax Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TN tax sale law. Tech: Annual June tax sale. 200+ properties typically. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-nashville-davidson-chancery-clerk",
    "label": "Nashville/Davidson County TN — Tax Sale Schedule",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Nashville/Davidson County TN — Tax Sale Schedule (city, TN). Official statutory source for tax deed.",
    "discoveryUrl": "https://chanceryclerkandmaster.nashville.gov/fees/property-tax-schedule",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Nashville/Davidson County TN — Tax Sale Schedule for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TN tax sale law. Tech: Schedule + TN Ledger Ad dates for tax sales. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-knox-tn-kgis-taxmap",
    "label": "Knox County TN — Tax Sale Properties Map (KGIS)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Knox County TN — Tax Sale Properties Map (KGIS) (county, TN). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.kgis.org/portal/AboutUs/PolicyBoard/TabId/93/ArtMID/497/ArticleID/5040/Property-Tax-Sale-Maps.aspx",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Knox County TN — Tax Sale Properties Map (KGIS) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "TN tax sale law. Tech: Interactive map of tax sale properties. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-orange-ca-treasurer-auction",
    "label": "Orange County CA — Tax-Defaulted Property Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Orange County CA — Tax-Defaulted Property Auction (county, CA). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.octreasurer.gov/taxauction",
    "access": "jurisdiction",
    "adapterKey": "ca-controller-tax-sale",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Orange County CA — Tax-Defaulted Property Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "RTC §3691. Public internet auction. Tech: Board of Supervisors approved. Tax-defaulted real estate + timeshares. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-ca-state-controller-auctions",
    "label": "California State Controller — Tax-Defaulted Public Auctions Directory",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "California State Controller — Tax-Defaulted Public Auctions Directory (state, CA). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.sco.ca.gov/ardtax_public_auction.html",
    "access": "jurisdiction",
    "adapterKey": "ca-controller-tax-sale",
    "status": "DISCOVERY_ONLY",
    "workflow": {
      "primary": "Inspect California State Controller — Tax-Defaulted Public Auctions Directory for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "CA RTC §3691. Per-county tax collectors conduct auctions. Tech: State controller's directory of all CA county tax auctions. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-king-wa-treasury-foreclosure",
    "label": "King County WA (Seattle) — Tax Foreclosure Auction",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "King County WA (Seattle) — Tax Foreclosure Auction (county, WA). Official statutory source for tax deed.",
    "discoveryUrl": "https://kingcounty.gov/en/dept/executive-services/buildings-property/treasury-operations/tax-foreclosures/auctions",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect King County WA (Seattle) — Tax Foreclosure Auction for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "RCW §84.64. Annual September auction. Tech: 'Where is' basis. Properties listed before auction. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-pierce-wa-foreclosure-purchase",
    "label": "Pierce County WA (Tacoma) — Foreclosure Property Purchase",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Pierce County WA (Tacoma) — Foreclosure Property Purchase (county, WA). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.piercecountywa.gov/718/Purchasing-Foreclosure-Property",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Pierce County WA (Tacoma) — Foreclosure Property Purchase for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "WA tax foreclosure law. Tech: Annual auction. Properties listed. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-snohomish-wa-foreclosure-details",
    "label": "Snohomish County WA — Tax Foreclosure Sale Details",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Snohomish County WA — Tax Foreclosure Sale Details (county, WA). Official statutory source for tax deed.",
    "discoveryUrl": "https://snohomishcountywa.gov/2755/Tax-Foreclosure-Sale-Details",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Snohomish County WA — Tax Foreclosure Sale Details for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "WA tax foreclosure law. Tech: Per-property sale details. Minimum bids. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-worcester-ma-foreclosure-auctions",
    "label": "Worcester MA — Tax Foreclosure Public Auctions",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Worcester MA — Tax Foreclosure Public Auctions (city, MA). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.worcesterma.gov/finance/liens-auctions/public-auctions",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Worcester MA — Tax Foreclosure Public Auctions for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "M.G.L. c.60. Municipal tax taking. Tech: Tax foreclosures vested in city name. List published. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-nyc-dof-in-rem-foreclosure",
    "label": "NYC Department of Finance — In Rem Foreclosure",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "NYC Department of Finance — In Rem Foreclosure (city, NY). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.nyc.gov/site/finance/property/in-rem-foreclosure.page",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect NYC Department of Finance — In Rem Foreclosure for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "NYC Adm. Code §11-424. Annual sale. Tech: Listings published annually. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "tax-indiana-pa-claim-bureau",
    "label": "Indiana County PA — Tax Claim Bureau Sale Listing (PDF)",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "Indiana County PA — Tax Claim Bureau Sale Listing (PDF) (county, PA). Official statutory source for tax deed.",
    "discoveryUrl": "https://www.indianacountypa.gov/wp-content/uploads/Website-Public-Listing.pdf",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect Indiana County PA — Tax Claim Bureau Sale Listing (PDF) for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "P.L. 1368; 72 P.S. §5971. Tech: PDF list of properties eligible for September tax sale. Extraction method: pdf_ocr. Cost: free. API: no."
  },
  {
    "id": "tax-dc-otr-annual-tax-sale",
    "label": "DC OTR — Annual Tax Sale",
    "category": "tax_sale",
    "role": "opportunity",
    "coverage": "DC OTR — Annual Tax Sale (state, DC). Official statutory source for tax deed.",
    "discoveryUrl": "https://taxsale.dc.gov",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Inspect DC OTR — Annual Tax Sale for delinquent tax property records and scheduled auctions.",
      "fallback": "Verify tax-default status and statutory redemption terms with the local tax collector or treasurer.",
      "cadenceHours": 168,
      "steps": [
        "Review published delinquent tax roll or scheduled tax-deed auction notices.",
        "Verify parcel APN, opening bid amount, redemption period, and cash-deposit terms.",
        "Preserve exact publisher record URL, auction ID, and source-observed timestamp."
      ]
    },
    "requiredEvidence": [
      "official county tax-sale notice or auction parcel ID",
      "APN or legal description",
      "opening bid or delinquent amount",
      "source-observed timestamp"
    ],
    "notes": "DC Code §47-1341. Tech: List published each spring. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-cook-il-civil-services",
    "label": "Cook County IL Sheriff — Foreclosure Property Sale",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Cook County IL Sheriff — Foreclosure Property Sale (county, IL). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://cookcountysheriffil.gov/departments/courts/civil-services/foreclosure-property-sale",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Cook County IL Sheriff — Foreclosure Property Sale for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "735 ILCS 5/15. Sheriff sales Mon–Fri 1pm at Daley Center. Tech: Weekly published property list. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-cuyahoga-oh-cpdocket",
    "label": "Cuyahoga County OH — Sheriff Foreclosure Sales Search",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Cuyahoga County OH — Sheriff Foreclosure Sales Search (county, OH). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://cpdocket.cp.cuyahogacounty.gov/SheriffSearch/printresults.aspx?q=searchType%3Ddate_range%26searchString%3D%26foreclosureType%3D%26dateFrom%3D%26dateTo%3D",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Cuyahoga County OH — Sheriff Foreclosure Sales Search for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "O.R.C. §2329.20. Online only. Tech: Searchable by date range. Lists case#, opening bid, sale date. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-franklin-oh-real-estate",
    "label": "Franklin County OH — Sheriff Real Estate Sales",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Franklin County OH — Sheriff Real Estate Sales (county, OH). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://sheriff.franklincountyohio.gov/real-estate-sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Franklin County OH — Sheriff Real Estate Sales for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "OH sheriff sale law. Tech: Active listings with appraisal + opening bid. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-cook-il-foreclosure-portal",
    "label": "Cook County IL — Foreclosure Auction Site",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Cook County IL — Foreclosure Auction Site (county, IL). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://foreclosure.ccsheriff.org",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Cook County IL — Foreclosure Auction Site for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "Cook County sheriff foreclosure auctions. Tech: Real-time auction listings with property addresses + opening bids. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-union-nj-sales-info",
    "label": "Union County NJ — Sheriff Sale Information",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Union County NJ — Sheriff Sale Information (county, NJ). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://ucnj.org/sheriff/functions/sheriffs-sale-information",
    "access": "jurisdiction",
    "adapterKey": "civilview",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Union County NJ — Sheriff Sale Information for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "N.J.S.A. 2A:50-37. Wednesday 2pm sales at Warinanco Ice Skating Center. Tech: Sheriff sale listings published weekly. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-middlesex-nj-foreclosures",
    "label": "Middlesex County NJ — Sheriff Foreclosure Sales",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Middlesex County NJ — Sheriff Foreclosure Sales (county, NJ). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.middlesexcountynj.gov/government/municipalities/foreclosures",
    "access": "jurisdiction",
    "adapterKey": "civilview",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Middlesex County NJ — Sheriff Foreclosure Sales for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "NJ sheriff sale law. Tech: Access Sales Listings button — current + upcoming sales. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-philadelphia-pa-foreclosures",
    "label": "Philadelphia PA — Sheriff Sale Properties",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Philadelphia PA — Sheriff Sale Properties (city, PA). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.phila.gov/services/property-lots-housing/foreclosure-sheriff-sales",
    "access": "jurisdiction",
    "adapterKey": "civilview",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Philadelphia PA — Sheriff Sale Properties for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "Pa.R.C.P. §3129. Monthly mortgage foreclosure + tax sale. Tech: Property listings + excess sheriff sale funds. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-montgomery-pa-sales",
    "label": "Montgomery County PA — Sheriff Sales",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Montgomery County PA — Sheriff Sales (county, PA). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.montgomerycountypa.gov/departments/sheriffs-office/sheriff-sales",
    "access": "jurisdiction",
    "adapterKey": "civilview",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Montgomery County PA — Sheriff Sales for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "PA sheriff sale law. Monthly sales. Tech: Upcoming sale dates + handbills (property listings). Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-chester-pa-handbills",
    "label": "Chester County PA — Sheriff Sales (Handbills)",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Chester County PA — Sheriff Sales (Handbills) (county, PA). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.chesco.org/3262/Sheriff-Sales",
    "access": "jurisdiction",
    "adapterKey": "civilview",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Chester County PA — Sheriff Sales (Handbills) for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "PA sheriff sale law. Tech: Handbills posted on properties. Listing reflects handbills. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-delaware-pa-real-estate",
    "label": "Delaware County PA — Sheriff Real Estate Sales",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Delaware County PA — Sheriff Real Estate Sales (county, PA). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.delcopa.gov/sheriff/real-estate",
    "access": "jurisdiction",
    "adapterKey": "civilview",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Delaware County PA — Sheriff Real Estate Sales for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "PA sheriff sale law. Tech: List on https://delcopa.gov/sheriff/ — Real Estate section. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-will-il-surplus-list",
    "label": "Will County IL — Sheriff Foreclosure Surplus List",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Will County IL — Sheriff Foreclosure Surplus List (county, IL). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.willcosheriff.org/civil-court/foreclosures/surplus-list",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Will County IL — Sheriff Foreclosure Surplus List for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "IL sheriff sale law. Tech: Foreclosure cases with surplus funds held by sheriff. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-fulton-ga-tax-sales",
    "label": "Fulton County GA — Sheriff Tax Sales",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Fulton County GA — Sheriff Tax Sales (county, GA). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://fultoncountyga.gov/inside-fulton-county/fulton-county-departments/sheriff/tax-sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Fulton County GA — Sheriff Tax Sales for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "O.C.G.A. §44-14-162. First Tuesday of month. Tech: Sheriff posts list 30 days prior. Property addresses + opening bids. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-clark-nv-civil-sales",
    "label": "Clark County NV (Las Vegas) — Sheriff Sales",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Clark County NV (Las Vegas) — Sheriff Sales (county, NV). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.clarkcountynv.gov/government/departments/sheriff_civil/sheriff_s_sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Clark County NV (Las Vegas) — Sheriff Sales for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "NRS §107.080. Trustee sales. Tech: Sheriff sales Tue/Wed/Thu on north entrance steps. List published. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "sheriff-clark-nv-annual-sales",
    "label": "Clark County NV — 2025 Sheriff Sales List",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Clark County NV — 2025 Sheriff Sales List (county, NV). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.clarkcountynv.gov/government/departments/sheriff_civil/sheriff_s_sales/2025-sales",
    "access": "jurisdiction",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Clark County NV — 2025 Sheriff Sales List for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "NV sheriff sale law. Tech: Property addresses + APN + attorney contact. Year-by-year archive. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "foreclosure-miamidade-realforeclose",
    "label": "Miami-Dade FL — Foreclosure Auction (RealForeclose)",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Miami-Dade FL — Foreclosure Auction (RealForeclose) (county, FL). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.miamidade.realforeclose.com/index.cfm",
    "access": "public",
    "adapterKey": "sheriff",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Miami-Dade FL — Foreclosure Auction (RealForeclose) for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "Fla. Stat. §702.03. Online auction via Grant Street. Tech: Daily foreclosure auction listings. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "foreclosure-miamidade-lis-pendens",
    "label": "Miami-Dade FL — Lis Pendens Search",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Miami-Dade FL — Lis Pendens Search (county, FL). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.miamidadeclerk.gov/clerk/search-public-records",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Miami-Dade FL — Lis Pendens Search for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "FL public records law. Lis Pendens = pre-foreclosure filing. Tech: Search official records. Filter by doc type = lis pendens. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "foreclosure-masslandrecords-suffolk",
    "label": "Suffolk County MA — MassLandRecords",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "Suffolk County MA — MassLandRecords (county, MA). Official statutory source for sheriff sale.",
    "discoveryUrl": "https://www.masslandrecords.com/suffolk",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor Suffolk County MA — MassLandRecords for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "MA public records. Tech: Suffolk County recorder. Search lis pendens + foreclosure deeds. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "foreclosure-lasvegas-abandoned-registry",
    "label": "City of Las Vegas — Abandoned Property Registry",
    "category": "foreclosure_auction",
    "role": "opportunity",
    "coverage": "City of Las Vegas — Abandoned Property Registry (city, NV). Official statutory source for foreclosure.",
    "discoveryUrl": "https://www.lasvegasnevada.gov/Business/Planning-Zoning/Code-Enforcement/Abandoned-Property-Registry",
    "access": "jurisdiction",
    "adapterKey": null,
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Monitor City of Las Vegas — Abandoned Property Registry for civil foreclosure sale notices and scheduled auctions.",
      "fallback": "Confirm foreclosure sale status with the county sheriff civil division or court clerk.",
      "cadenceHours": 24,
      "steps": [
        "Examine sheriff foreclosure sale calendar and legal advertisement notices.",
        "Extract case number, plaintiff/defendant, property address, and minimum bid.",
        "Confirm sale status and adjournment history with the civil process office."
      ]
    },
    "requiredEvidence": [
      "sheriff or court sale notice and case number",
      "property address or legal description",
      "scheduled sale date and bid terms",
      "source-observed timestamp"
    ],
    "notes": "NV public records. Based on Clark County Recorder foreclosure records. Tech: Database of abandoned/foreclosed properties. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-detroit-dlba",
    "label": "Detroit Land Bank Authority — Available Properties",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Detroit Land Bank Authority — Available Properties (city, MI). Official statutory source for land bank.",
    "discoveryUrl": "https://buildingdetroit.org/properties",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Detroit Land Bank Authority — Available Properties for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Owns ~95,000 Detroit parcels. Auctions + side-lot sales. Tech: Open Data Portal: data.detroitmi.gov. JSON endpoint for inventory. Extraction method: api. Cost: free. API: yes."
  },
  {
    "id": "landbank-detroit-sidelots",
    "label": "Detroit Land Bank — Side Lots ($250)",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Detroit Land Bank — Side Lots ($250) (city, MI). Official statutory source for land bank.",
    "discoveryUrl": "https://buildingdetroit.org/properties/?category=3",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Detroit Land Bank — Side Lots ($250) for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Side lots $250 for adjacent homeowners. Tech: Filter: category=3 = vacant lots. Extraction method: api. Cost: free. API: yes."
  },
  {
    "id": "landbank-detroit-opendata-dataset",
    "label": "Detroit Open Data — DLBA Owned Properties Dataset",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Detroit Open Data — DLBA Owned Properties Dataset (city, MI). Official statutory source for land bank.",
    "discoveryUrl": "https://data.detroitmi.gov/datasets/848bc665295f4ca9b1e25068ffa88ab0_0/about",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Detroit Open Data — DLBA Owned Properties Dataset for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Open data. Tech: Each row = a DLBA-owned property. Socrata API available. Extraction method: api. Cost: free. API: yes."
  },
  {
    "id": "landbank-cuyahoga-available-properties",
    "label": "Cuyahoga Land Bank — All Available Properties",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Cuyahoga Land Bank — All Available Properties (county, OH). Official statutory source for land bank.",
    "discoveryUrl": "https://cuyahogalandbank.org/all-available-properties",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cuyahoga Land Bank — All Available Properties for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Cuyahoga County land bank. Tech: Per-property: parcel#, address. Active listings. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-cuyahoga-sideyard-properties",
    "label": "Cuyahoga Land Bank — Available Side Yard Properties",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Cuyahoga Land Bank — Available Side Yard Properties (county, OH). Official statutory source for land bank.",
    "discoveryUrl": "https://cuyahogalandbank.org/available-side-yard-properties",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cuyahoga Land Bank — Available Side Yard Properties for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Vacant lots for adjacent homeowners. Tech: List of currently available vacant lots. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-cuyahoga-homes",
    "label": "Cuyahoga Land Bank — Land Bank Homes",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Cuyahoga Land Bank — Land Bank Homes (county, OH). Official statutory source for land bank.",
    "discoveryUrl": "https://cuyahogalandbank.org/land-bank-homes",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cuyahoga Land Bank — Land Bank Homes for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Renovation branch of Cuyahoga Land Bank. Tech: Rehabilitated homes for sale. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-cook-county-inventory",
    "label": "Cook County Land Bank — Property Inventory",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Cook County Land Bank — Property Inventory (county, IL). Official statutory source for land bank.",
    "discoveryUrl": "https://cookcountylandbank.org/what-are-you-looking-for",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cook County Land Bank — Property Inventory for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Largest IL land bank. Tech: Homebuyer Program + investor inventory. Property listings. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-cook-county-government",
    "label": "Cook County IL — Buy Land Bank Property",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Cook County IL — Buy Land Bank Property (county, IL). Official statutory source for land bank.",
    "discoveryUrl": "https://www.cookcountyil.gov/service/buy-land-bank-property",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cook County IL — Buy Land Bank Property for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Cook County land bank. Tech: Property inventory + application process. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-cleveland-program",
    "label": "City of Cleveland — Land Bank Program",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "City of Cleveland — Land Bank Program (city, OH). Official statutory source for land bank.",
    "discoveryUrl": "https://www.clevelandohio.gov/city-hall/departments/community-development/programs-services/cleveland-land-bank",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search City of Cleveland — Land Bank Program for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Cleveland city land bank. Tech: $10/sqft. Application process. Paused as of 2025. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "landbank-community-progress-national-map",
    "label": "Center for Community Progress — National Land Bank Map",
    "category": "land_bank",
    "role": "opportunity",
    "coverage": "Center for Community Progress — National Land Bank Map (national, US). Official statutory source for land bank.",
    "discoveryUrl": "https://communityprogress.org/resources/land-banks/national-land-bank-map",
    "access": "public",
    "adapterKey": "landbank",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Center for Community Progress — National Land Bank Map for available residential, commercial, or side-lot properties.",
      "fallback": "Contact the land bank authority or municipal community development agency.",
      "cadenceHours": 168,
      "steps": [
        "Query land bank available inventory portal or open data records.",
        "Capture property parcel identifier, asking price, and program eligibility requirements.",
        "Verify compliance with local redevelopment guidelines before offer submission."
      ]
    },
    "requiredEvidence": [
      "official land bank property identifier or parcel number",
      "listing price and acquisition program terms",
      "source-observed timestamp"
    ],
    "notes": "Master directory of 350+ US land banks. Tech: Interactive map. Each land bank links to its property inventory. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "bankreo-bank-of-america-foreclosures",
    "label": "Bank of America REO — Property Search",
    "category": "marketplace",
    "role": "opportunity",
    "coverage": "Bank of America REO — Property Search (national, US). Official statutory source for bank seized.",
    "discoveryUrl": "https://foreclosures.bankofamerica.com/search",
    "access": "public",
    "adapterKey": null,
    "status": "DISCOVERY_ONLY",
    "workflow": {
      "primary": "Search Bank of America REO — Property Search for institution-owned real estate (REO) inventory.",
      "fallback": "Contact designated bank asset management office or listing agent.",
      "cadenceHours": 24,
      "steps": [
        "Query bank foreclosure and REO disposition portal for target state and county.",
        "Capture property address, listing price, asset ID, and offer submission instructions.",
        "Verify occupancy status and clear title terms with asset manager."
      ]
    },
    "requiredEvidence": [
      "bank asset identifier or listing URL",
      "list price and offer submission window",
      "source-observed timestamp"
    ],
    "notes": "BoA REO inventory. Tech: Search by state/zip. Per-property detail pages. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "bankreo-boa-real-estate-center",
    "label": "BoA Real Estate Center — Bank-Owned Search",
    "category": "marketplace",
    "role": "opportunity",
    "coverage": "BoA Real Estate Center — Bank-Owned Search (national, US). Official statutory source for bank seized.",
    "discoveryUrl": "https://realestatecenter.bankofamerica.com",
    "access": "public",
    "adapterKey": null,
    "status": "DISCOVERY_ONLY",
    "workflow": {
      "primary": "Search BoA Real Estate Center — Bank-Owned Search for institution-owned real estate (REO) inventory.",
      "fallback": "Contact designated bank asset management office or listing agent.",
      "cadenceHours": 24,
      "steps": [
        "Query bank foreclosure and REO disposition portal for target state and county.",
        "Capture property address, listing price, asset ID, and offer submission instructions.",
        "Verify occupancy status and clear title terms with asset manager."
      ]
    },
    "requiredEvidence": [
      "bank asset identifier or listing URL",
      "list price and offer submission window",
      "source-observed timestamp"
    ],
    "notes": "BoA REO. Tech: Filter = 'Bank owned'. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "bankreo-wells-fargo-listings",
    "label": "Wells Fargo REO — Property Listings",
    "category": "marketplace",
    "role": "opportunity",
    "coverage": "Wells Fargo REO — Property Listings (national, US). Official statutory source for bank seized.",
    "discoveryUrl": "https://wellsfargoforeclosures.com",
    "access": "public",
    "adapterKey": null,
    "status": "DISCOVERY_ONLY",
    "workflow": {
      "primary": "Search Wells Fargo REO — Property Listings for institution-owned real estate (REO) inventory.",
      "fallback": "Contact designated bank asset management office or listing agent.",
      "cadenceHours": 24,
      "steps": [
        "Query bank foreclosure and REO disposition portal for target state and county.",
        "Capture property address, listing price, asset ID, and offer submission instructions.",
        "Verify occupancy status and clear title terms with asset manager."
      ]
    },
    "requiredEvidence": [
      "bank asset identifier or listing URL",
      "list price and offer submission window",
      "source-observed timestamp"
    ],
    "notes": "Wells Fargo REO. Tech: Search by state. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "bankreo-us-bank-residential",
    "label": "US Bank REO — Property Listings",
    "category": "marketplace",
    "role": "opportunity",
    "coverage": "US Bank REO — Property Listings (national, US). Official statutory source for bank seized.",
    "discoveryUrl": "https://www.usbank.com/splash/real-estate/bank-owned-residential-real-estate-for-sale.html",
    "access": "public",
    "adapterKey": null,
    "status": "DISCOVERY_ONLY",
    "workflow": {
      "primary": "Search US Bank REO — Property Listings for institution-owned real estate (REO) inventory.",
      "fallback": "Contact designated bank asset management office or listing agent.",
      "cadenceHours": 24,
      "steps": [
        "Query bank foreclosure and REO disposition portal for target state and county.",
        "Capture property address, listing price, asset ID, and offer submission instructions.",
        "Verify occupancy status and clear title terms with asset manager."
      ]
    },
    "requiredEvidence": [
      "bank asset identifier or listing URL",
      "list price and offer submission window",
      "source-observed timestamp"
    ],
    "notes": "US Bank REO. Tech: Listed by state. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "bankreo-regions-bank-properties",
    "label": "Regions Bank — Real Estate Properties",
    "category": "marketplace",
    "role": "opportunity",
    "coverage": "Regions Bank — Real Estate Properties (national, US). Official statutory source for bank seized.",
    "discoveryUrl": "https://www.regions.com/real-estate-properties",
    "access": "public",
    "adapterKey": null,
    "status": "DISCOVERY_ONLY",
    "workflow": {
      "primary": "Search Regions Bank — Real Estate Properties for institution-owned real estate (REO) inventory.",
      "fallback": "Contact designated bank asset management office or listing agent.",
      "cadenceHours": 24,
      "steps": [
        "Query bank foreclosure and REO disposition portal for target state and county.",
        "Capture property address, listing price, asset ID, and offer submission instructions.",
        "Verify occupancy status and clear title terms with asset manager."
      ]
    },
    "requiredEvidence": [
      "bank asset identifier or listing URL",
      "list price and offer submission window",
      "source-observed timestamp"
    ],
    "notes": "Regions Bank REO (residential, commercial, land). Tech: Per-state listing. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "bankreo-hud-gov-homes-for-sale",
    "label": "HUD.gov — Homes for Sale",
    "category": "marketplace",
    "role": "opportunity",
    "coverage": "HUD.gov — Homes for Sale (national, US). Official statutory source for bank seized.",
    "discoveryUrl": "https://www.hud.gov/helping-americans/homes-for-sale",
    "access": "public",
    "adapterKey": "hud",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search HUD.gov — Homes for Sale for institution-owned real estate (REO) inventory.",
      "fallback": "Contact designated bank asset management office or listing agent.",
      "cadenceHours": 24,
      "steps": [
        "Query bank foreclosure and REO disposition portal for target state and county.",
        "Capture property address, listing price, asset ID, and offer submission instructions.",
        "Verify occupancy status and clear title terms with asset manager."
      ]
    },
    "requiredEvidence": [
      "bank asset identifier or listing URL",
      "list price and offer submission window",
      "source-observed timestamp"
    ],
    "notes": "HUD single-family + multifamily REO. Tech: Single-family via HomeStore. Multifamily via separate portal. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-nyc-websurrogates-case-search",
    "label": "NYC Surrogate's Court — WebSurrogate Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "NYC Surrogate's Court — WebSurrogate Case Search (state, NY). Official statutory source for probate.",
    "discoveryUrl": "https://websurrogates.nycourts.gov",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search NYC Surrogate's Court — WebSurrogate Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "NY SCPA. Per-county surrogate's court. Free service. Tech: Search files, retrieve documents, view historical records. Name/File/Old Index/Will search. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-kings-ny-surrogates-court",
    "label": "Kings County NY (Brooklyn) Surrogate's Court",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Kings County NY (Brooklyn) Surrogate's Court (county, NY). Official statutory source for probate.",
    "discoveryUrl": "https://www.nycourts.gov/courts/2jd/surrogates/kings",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Kings County NY (Brooklyn) Surrogate's Court for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "NY SCPA. Tech: WebSurrogate case search via nycourts.gov. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-newyork-ny-surrogates-court",
    "label": "New York County (Manhattan) Surrogate's Court",
    "category": "court_record",
    "role": "evidence",
    "coverage": "New York County (Manhattan) Surrogate's Court (county, NY). Official statutory source for probate.",
    "discoveryUrl": "https://www.nycourts.gov/courts/1st-judicial-district/new-york-county-surrogates-court",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search New York County (Manhattan) Surrogate's Court for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "NY SCPA. Tech: Probate Department (decedents leaving wills) + Administration Department (intestate). Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-cook-il-probate-division",
    "label": "Cook County IL — Probate Division Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Cook County IL — Probate Division Case Search (county, IL). Official statutory source for probate.",
    "discoveryUrl": "https://www.cookcountycourt.org/ABOUT-THE-COURT/County-Departments/Probate-Division",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cook County IL — Probate Division Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "755 ILCS 5. Probate Act. Tech: Cook County probate court. Case search via court clerk. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-cuyahoga-oh-court-search",
    "label": "Cuyahoga County OH — Probate Court Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Cuyahoga County OH — Probate Court Case Search (county, OH). Official statutory source for probate.",
    "discoveryUrl": "https://probate.cuyahogacounty.us",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Cuyahoga County OH — Probate Court Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "Ohio Rev. Code §2101. Tech: Case search by name, case number, or date. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-harris-tx-court-search",
    "label": "Harris County TX — Probate Court Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Harris County TX — Probate Court Case Search (county, TX). Official statutory source for probate.",
    "discoveryUrl": "https://www.harriscountytx.gov/Departments/Courts/Probate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Harris County TX — Probate Court Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "Tex. Est. Code. County court at law handles probate. Tech: Harris County has 4 statutory probate courts. Case search online. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-dallas-tx-court-search",
    "label": "Dallas County TX — Probate Court Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Dallas County TX — Probate Court Case Search (county, TX). Official statutory source for probate.",
    "discoveryUrl": "https://www.dallascounty.org/government/courts/county-courts-at-law/probate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Dallas County TX — Probate Court Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "TX probate law. Tech: Online case search. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-losangeles-ca-superior-court",
    "label": "Los Angeles County CA — Superior Court Probate",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Los Angeles County CA — Superior Court Probate (county, CA). Official statutory source for probate.",
    "discoveryUrl": "https://www.lacourt.org/division/probate/probate.aspx",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Los Angeles County CA — Superior Court Probate for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "Cal. Prob. Code. Per-county superior court probate division. Tech: Case search via lacourt.org. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-sandiego-ca-case-search",
    "label": "San Diego County CA — Probate Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "San Diego County CA — Probate Case Search (county, CA). Official statutory source for probate.",
    "discoveryUrl": "https://www.sdcourt.ca.gov/sdcourt/civil/probate2",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search San Diego County CA — Probate Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "CA probate law. Tech: Online case search. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-fulton-ga-court-search",
    "label": "Fulton County GA — Probate Court Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Fulton County GA — Probate Court Case Search (county, GA). Official statutory source for probate.",
    "discoveryUrl": "https://probate.fultoncountyga.gov",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Fulton County GA — Probate Court Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "O.C.G.A. §15-9-1. Tech: Case search online. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-wayne-mi-third-circuit",
    "label": "Wayne County MI — Probate Court Case Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Wayne County MI — Probate Court Case Search (county, MI). Official statutory source for probate.",
    "discoveryUrl": "https://www.3rdcc.org/divisions/probate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Wayne County MI — Probate Court Case Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "MCL §600.841. Tech: 3rd Circuit Court Probate Division. Case search. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-essex-nj-surrogates-court",
    "label": "Essex County NJ — Surrogate's Court",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Essex County NJ — Surrogate's Court (county, NJ). Official statutory source for probate.",
    "discoveryUrl": "https://www.essexcountynj.org/essex-county-surrogate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Essex County NJ — Surrogate's Court for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "N.J.S.A. 3B. Tech: Per-county surrogate. Search probate records. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-philadelphia-pa-register-of-wills",
    "label": "Philadelphia PA — Register of Wills",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Philadelphia PA — Register of Wills (city, PA). Official statutory source for probate.",
    "discoveryUrl": "https://secure.phila.gov/PROBATE",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Philadelphia PA — Register of Wills for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "20 Pa.C.S. Tech: Online case search via secure.phila.gov/PROBATE. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-pima-az-superior-court",
    "label": "Pima County AZ (Tucson) — Superior Court Probate",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Pima County AZ (Tucson) — Superior Court Probate (county, AZ). Official statutory source for probate.",
    "discoveryUrl": "https://www.sc.pima.gov/calendar-departments/probate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Pima County AZ (Tucson) — Superior Court Probate for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "A.R.S. §14. Tech: Superior court probate division. Case search. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-maricopa-az-superior-court",
    "label": "Maricopa County AZ (Phoenix) — Superior Court Probate",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Maricopa County AZ (Phoenix) — Superior Court Probate (county, AZ). Official statutory source for probate.",
    "discoveryUrl": "https://www.superiorcourt.maricopa.gov/llrc/probate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Maricopa County AZ (Phoenix) — Superior Court Probate for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "AZ probate law. Tech: Probate case search via superior court. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-king-wa-superior-court",
    "label": "King County WA (Seattle) — Superior Court Probate",
    "category": "court_record",
    "role": "evidence",
    "coverage": "King County WA (Seattle) — Superior Court Probate (county, WA). Official statutory source for probate.",
    "discoveryUrl": "https://www.kingcounty.gov/courts/superior-court/probate",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search King County WA (Seattle) — Superior Court Probate for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "RCW §11. Tech: Case search via King County Superior Court. Extraction method: html_scrape. Cost: free. API: no."
  },
  {
    "id": "probate-miamidade-fl-civil-probate",
    "label": "Miami-Dade FL — Probate Division Search",
    "category": "court_record",
    "role": "evidence",
    "coverage": "Miami-Dade FL — Probate Division Search (county, FL). Official statutory source for probate.",
    "discoveryUrl": "https://www.miamidadeclerk.gov/clerk/civil-family-probate-divisions.page",
    "access": "jurisdiction",
    "adapterKey": "courtlistener",
    "status": "LOCAL_ROUTE",
    "workflow": {
      "primary": "Search Miami-Dade FL — Probate Division Search for open probate estate filings and real-property assets.",
      "fallback": "Inspect records in person at the county surrogate or probate court clerk counter.",
      "cadenceHours": 168,
      "steps": [
        "Search probate court docket for open decedent estate administration cases.",
        "Cross-reference estate petitions with recorded real-estate holdings.",
        "Retain case docket number, personal representative details, and court observation date."
      ]
    },
    "requiredEvidence": [
      "probate court case/docket number",
      "decedent estate title and court identifier",
      "source-observed timestamp"
    ],
    "notes": "Fla. Prob. Code. Tech: Circuit court probate division. Brenda case search. Extraction method: html_scrape. Cost: free. API: no."
  }
]);

module.exports = {
  STATUTORY_DISTRESS_CATALOG_ENTRIES
};
