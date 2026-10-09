'use strict';

/**
 * server/scrapers/adapters/realauction.js
 *
 * RealAuction Multi-County Foreclosure Platform Adapter.
 * Powers online foreclosure auctions in Ohio ({county}.sheriffsaleauction.ohio.gov)
 * and Florida ({county}.realforeclose.com).
 */

const { normalizeOcrText } = require('../../ai/notice-parser');

const REALAUCTION_OHIO_COUNTIES = Object.freeze([
  'cuyahoga', 'franklin', 'hamilton', 'summit', 'montgomery',
  'lucas', 'butler', 'stark', 'lorain', 'mahoning', 'warren', 'lake',
]);

const REALAUCTION_FLORIDA_COUNTIES = Object.freeze([
  'miamidade', 'broward', 'palmbeach', 'orange', 'hillsborough',
  'pinellas', 'duval', 'lee', 'polk', 'brevard', 'volusia', 'pasco',
]);

function getRealAuctionUrl(county = 'cuyahoga', state = 'OH') {
  const cleanCounty = String(county || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const st = String(state || 'OH').toUpperCase();

  if (st === 'OH') {
    return `https://${cleanCounty}.sheriffsaleauction.ohio.gov/index.cfm?zaction=AUCTION&Zmethod=PREVIEW`;
  }
  return `https://${cleanCounty}.realforeclose.com/index.cfm?zaction=AUCTION&Zmethod=PREVIEW`;
}

function parseRealAuctionCard(cardHtml = '', county = 'cuyahoga', state = 'OH') {
  const text = String(cardHtml || '');
  if (!text) return null;

  // Case Number: e.g. "Case #: CV-24-991201"
  const caseMatch = text.match(/(?:Case\s*(?:#|No\.?):?)\s*([0-9A-Za-z\-_]+)/i);
  // Auction ID: e.g. "Auction ID: 104921" or "Item: 48"
  const auctionIdMatch = text.match(/(?:Auction\s*ID|Item\s*#?):?\s*([0-9]+)/i);
  // Opening bid / Minimum bid
  const bidMatch = text.match(/(?:Opening\s*Bid|Minimum\s*Bid|Starting\s*Bid):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Final Judgment amount
  const judgmentMatch = text.match(/(?:Final\s*Judgment|Judgment\s*Amount):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Assessed value / Appraised value
  const assessedMatch = text.match(/(?:Appraised\s*Value|Assessed\s*Value):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
  // Address: e.g. "Property Address: 4928 Broadview Rd, Cleveland, OH 44109"
  const addrMatch = text.match(/(?:Property\s*Address|Address):?\s*([^<\n\r]+)/i);
  // Parcel ID: e.g. "Parcel ID: 012-34-567"
  const parcelMatch = text.match(/(?:Parcel\s*(?:ID|#?)|APN):?\s*([0-9A-Za-z\-_.]+)/i);
  // Auction Date: e.g. "Auction Date: 11/04/2026 09:00 AM"
  const dateMatch = text.match(/(?:Auction\s*Date|Sale\s*Date):?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);

  if (!caseMatch && !auctionIdMatch && !addrMatch) {
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

  return {
    source: 'sheriff',
    platform: 'realauction',
    county: countyCapitalized,
    state: cleanState,
    auctionId: auctionIdMatch ? auctionIdMatch[1] : null,
    caseNumber: caseMatch ? caseMatch[1] : null,
    parcelId: parcelMatch ? parcelMatch[1] : null,
    address: cleanAddress,
    zip: zipMatch ? zipMatch[0] : null,
    openingBid,
    judgment,
    assessed,
    saleDate: dateMatch ? dateMatch[1] : null,
    sourceUrl: getRealAuctionUrl(county, state),
  };
}

/**
 * Parses full RealAuction preview HTML docket
 */
function parseRealAuctionDocketHtml(html = '', county = 'cuyahoga', state = 'OH') {
  const text = String(html || '');
  const listings = [];

  // Cards are structured inside table rows or auction card containers
  const cardRegex = /<(?:div|table)\b[^>]*(?:class="[^"]*(?:Auction_W|tbl_list_data|AUCTION_ITEM)[^"]*"|id="[^"]*Auction_[0-9]+")[^>]*>([\s\S]*?)<\/(?:div|table)>/gi;
  let match;

  while ((match = cardRegex.exec(text)) !== null) {
    const cardHtml = match[1];
    const parsed = parseRealAuctionCard(cardHtml, county, state);
    if (parsed && (parsed.caseNumber || parsed.auctionId || parsed.address)) {
      listings.push(parsed);
    }
  }

  // Fallback: If container regex yielded nothing, split on AUCTION_ITEM or Case markers
  if (listings.length === 0 && /(?:Case\s*#|Auction\s*ID)/i.test(text)) {
    const blocks = text.split(/(?=(?:Case\s*(?:#|No\.)|Auction\s*ID):)/i);
    for (const block of blocks) {
      const parsed = parseRealAuctionCard(block, county, state);
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
  getRealAuctionUrl,
  parseRealAuctionCard,
  parseRealAuctionDocketHtml,
};
