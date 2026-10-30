'use strict';

/**
 * server/scrapers/adapters/realauction.js
 *
 * RealAuction Multi-County Foreclosure & Tax-Deed Platform Adapter.
 * Powers online foreclosure & tax-deed auctions in:
 * - Ohio ({county}.sheriffsaleauction.ohio.gov)
 * - Florida Foreclosure ({county}.realforeclose.com)
 * - Florida Tax Deed ({county}.realtaxdeed.com)
 */

const { normalizeOcrText } = require('../../ai/notice-parser');

const REALAUCTION_OHIO_COUNTIES = Object.freeze([
  'cuyahoga', 'franklin', 'hamilton', 'summit', 'montgomery',
  'lucas', 'butler', 'stark', 'lorain', 'mahoning', 'warren',
  'clermont', 'delaware', 'lake', 'trumbull', 'wood', 'allen',
  'fairfield', 'clark', 'licking',
]);

const REALAUCTION_FLORIDA_COUNTIES = Object.freeze([
  'alachua', 'bay', 'brevard', 'broward', 'charlotte', 'citrus', 'clay', 'collier',
  'duval', 'escambia', 'hernando', 'hillsborough', 'indianriver', 'lake', 'lee',
  'manatee', 'marion', 'martin', 'miamidade', 'okaloosa', 'orange', 'osceola',
  'palmbeach', 'pasco', 'pinellas', 'polk', 'santarosa', 'sarasota', 'seminole',
  'stjohns', 'stlucie', 'volusia',
]);

const REALAUCTION_FLORIDA_TAXDEED_COUNTIES = Object.freeze([
  'alachua', 'bay', 'brevard', 'broward', 'charlotte', 'citrus', 'clay', 'collier',
  'duval', 'escambia', 'hernando', 'hillsborough', 'indianriver', 'lake', 'lee',
  'manatee', 'marion', 'martin', 'miamidade', 'okaloosa', 'orange', 'osceola',
  'palmbeach', 'pasco', 'pinellas', 'polk', 'santarosa', 'sarasota', 'seminole',
  'stjohns', 'stlucie', 'volusia',
]);

function getRealAuctionUrl(county = 'cuyahoga', state = 'OH', options = {}) {
  const cleanCounty = String(county || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const st = String(state || 'OH').toUpperCase();
  const mode = options && options.mode === 'taxdeed' ? 'taxdeed' : 'foreclosure';
  let domain;
  if (options && typeof options.domain === 'string' && options.domain.trim()) {
    domain = options.domain.trim().replace(/^https?:\/\//i, '');
  } else if (mode === 'taxdeed') {
    domain = `${cleanCounty}.realtaxdeed.com`;
  } else if (st === 'OH') {
    domain = `${cleanCounty}.sheriffsaleauction.ohio.gov`;
  } else {
    domain = `${cleanCounty}.realforeclose.com`;
  }
  let url = `https://${domain}/index.cfm?zaction=AUCTION&Zmethod=PREVIEW`;
  if (options && typeof options === 'object') {
    if (options.auctionId) {
      url += `&aid=${encodeURIComponent(options.auctionId)}`;
    } else if (options.caseNumber) {
      url += `&case=${encodeURIComponent(options.caseNumber)}`;
    } else if (options.certificateNumber) {
      url += `&case=${encodeURIComponent(options.certificateNumber)}`;
    }
  }
  return url;
}

function parseRealAuctionCard(cardHtml = '', county = 'cuyahoga', state = 'OH', options = {}) {
  const text = String(cardHtml || '');
  if (!text) return null;

  // Case Number: e.g. "Case #: CV-24-991201"
  const caseMatch = text.match(/Case\s*(?:#|No\.?):?\s*([0-9A-Za-z\-_]+)/i);
  // Florida Tax Certificate Number: e.g. "Certificate #: 2023-10492" or "Tax Cert #: 2023-10492"
  const certMatch = text.match(/Certificate\s*(?:#|No\.?):?\s*([0-9A-Za-z\-_]+)/i) ||
    text.match(/(?:Tax\s*Cert(?:ificate)?|Cert)\s*#?:?\s*([0-9A-Za-z\-_]+)/i);
  // Auction ID: e.g. "Auction ID: 104921" or "Item: 48"
  const auctionIdMatch = text.match(/(?:Auction\s*ID|Item\s*#?):?\s*([0-9]+)/i);
  // Homestead Exemption: detect if card text mentions /Homestead(?:\s*Exemption)?\s*:\s*(?:Yes|True|Y)\b/i
  let homestead = null;
  if (/Homestead(?:\s*Exemption)?\s*:\s*(?:Yes|True|Y)\b/i.test(text)) {
    homestead = true;
  } else if (/Homestead(?:\s*Exemption)?\s*:\s*(?:No|False|N)\b/i.test(text)) {
    homestead = false;
  }
  // Opening bid / Minimum bid / Starting bid / Upset bid
  const bidMatch = text.match(/(?:Opening\s*Bid|Minimum\s*Bid|Starting\s*Bid|Upset\s*Bid):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Final Judgment amount
  const judgmentMatch = text.match(/(?:Final\s*Judgment|Judgment\s*Amount):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Assessed value / Appraised value
  const assessedMatch = text.match(/(?:Appraised\s*Value|Assessed\s*Value):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Address: e.g. "Property Address: 4928 Broadview Rd, Cleveland, OH 44109"
  const addrMatch = text.match(/(?:Property\s*Address|Address):?\s*([^<\n\r]+)/i);
  // Parcel ID / APN: e.g. "Parcel ID: 012-34-567" or "APN: 123-456"
  const parcelMatch = text.match(/(?:Parcel\s*(?:ID|#?)|APN):?\s*([0-9A-Za-z\-_.]+)/i);
  // Auction Date: e.g. "Auction Date: 11/04/2026"
  const dateMatch = text.match(/(?:Auction\s*Date|Sale\s*Date):?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);

  if (!caseMatch && !certMatch && !auctionIdMatch && !addrMatch) {
    return null;
  }

  const openingBid = bidMatch ? parseFloat(bidMatch[1].replace(/,/g, '')) : null;
  const judgment = judgmentMatch ? parseFloat(judgmentMatch[1].replace(/,/g, '')) : null;
  const assessed = assessedMatch ? parseFloat(assessedMatch[1].replace(/,/g, '')) : null;

  const rawAddr = addrMatch ? addrMatch[1].replace(/<[^>]+>/g, '').trim() : '';
  const cleanAddress = normalizeOcrText(rawAddr).replace(/\s+/g, ' ').trim();
  const zipMatch = cleanAddress.match(/\b\d{5}\b/);

  const countyCapitalized = county.charAt(0).toUpperCase() + county.slice(1).toLowerCase();
  const cleanState = state.toUpperCase();

  const caseNumber = caseMatch ? caseMatch[1] : null;
  const certificateNumber = certMatch ? certMatch[1] : null;

  return {
    source: 'sheriff',
    platform: options && options.mode === 'taxdeed' ? 'realtaxdeed' : 'realauction',
    county: countyCapitalized,
    state: cleanState,
    auctionId: auctionIdMatch ? auctionIdMatch[1] : null,
    caseNumber,
    certificateNumber,
    homestead,
    parcelId: parcelMatch ? parcelMatch[1] : null,
    address: cleanAddress,
    zip: zipMatch ? zipMatch[0] : null,
    openingBid,
    judgment,
    assessed,
    saleDate: dateMatch ? dateMatch[1] : null,
    cardHtml: text,
    sourceUrl: getRealAuctionUrl(county, state, {
      ...options,
      auctionId: auctionIdMatch ? auctionIdMatch[1] : null,
      caseNumber,
      certificateNumber,
    }),
  };
}

/**
 * Parses full RealAuction preview HTML docket
 */
function parseRealAuctionDocketHtml(html = '', county = 'cuyahoga', state = 'OH', options = {}) {
  const text = String(html || '');
  const listings = [];

  // Cards are structured inside table rows or auction card containers
  const cardRegex = /<(?:div|table)\b[^>]*(?:class="[^"]*(?:Auction_W|tbl_list_data|AUCTION_ITEM)[^"]*"|id="[^"]*Auction_[0-9]+")[^>]*>([\s\S]*?)<\/(?:div|table)>/gi;
  let match;

  while ((match = cardRegex.exec(text)) !== null) {
    const cardHtml = match[1];
    const parsed = parseRealAuctionCard(cardHtml, county, state, options);
    if (parsed && (parsed.caseNumber || parsed.certificateNumber || parsed.auctionId || parsed.address)) {
      listings.push(parsed);
    }
  }

  // Fallback: If container regex yielded nothing, split on AUCTION_ITEM or Case markers
  if (listings.length === 0 && /(?:Case\s*#|(?:Tax\s*Cert(?:ificate)?|Certificate|Cert)\s*#|Auction\s*ID)/i.test(text)) {
    const blocks = text.split(/(?=(?:Case\s*(?:#|No\.)|(?:Tax\s*Cert(?:ificate)?|Certificate|Cert)\s*(?:#|No\.)|Auction\s*ID):?)/i);
    for (const block of blocks) {
      const parsed = parseRealAuctionCard(block, county, state, options);
      if (parsed && parsed.address) {
        listings.push(parsed);
      }
    }
  }

  return listings;
}

module.exports = {
  REALAUCTION_OHIO_COUNTIES,
  REALAUCTION_FLORIDA_COUNTIES,
  REALAUCTION_FLORIDA_TAXDEED_COUNTIES,
  getRealAuctionUrl,
  parseRealAuctionCard,
  parseRealAuctionDocketHtml,
};
