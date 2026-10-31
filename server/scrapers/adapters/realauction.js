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

/**
 * RealAuction ColdFusion retHTML macro decompression dictionary.
 * RealAuction encodes repetitive HTML fragments with @A through @L macros.
 */
function decodeRealAuctionMacros(raw = '') {
  if (!raw) return '';
  return String(raw)
    .replace(/@A/g, '<div class="')
    .replace(/@B/g, '</div>')
    .replace(/@C/g, 'class="')
    .replace(/@D/g, '<div>')
    .replace(/@E/g, 'AUCTION')
    .replace(/@F/g, '</td><td')
    .replace(/@G/g, '</td></tr>')
    .replace(/@H/g, '<tr><td ')
    .replace(/@I/g, 'table')
    .replace(/@J/g, 'p_back="NextCheck=')
    .replace(/@K/g, 'style="Display:none"')
    .replace(/@L/g, '/index.cfm?zaction=auction&zmethod=details&AID=');
}

/**
 * Parses key-value pairs from RealAuction ad_tab tables.
 * Handles multiline address continuations where label cell is blank.
 */
function parseAdTabTable(tableHtml = '') {
  const fields = {};
  let lastKey = null;
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const row = rowMatch[1];
    const lblMatch = row.match(/<(?:th|td)[^>]*class="[^"]*AD_LBL[^"]*"[^>]*>([\s\S]*?)<\/(?:th|td)>/i);
    const dtaMatch = row.match(/<td[^>]*class="[^"]*AD_DTA[^"]*"[^>]*>([\s\S]*?)<\/td>/i);
    if (!dtaMatch) continue;
    const rawVal = dtaMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();
    if (!rawVal) continue;
    const rawKey = lblMatch ? lblMatch[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/:$/, '').trim() : '';
    if (rawKey) {
      const k = rawKey.toLowerCase();
      fields[k] = rawVal;
      lastKey = k;
    } else if (lastKey === 'property address' || lastKey === 'address') {
      fields[lastKey] = (fields[lastKey] + ', ' + rawVal).replace(/\s+,/g, ',');
    }
  }
  return fields;
}

function parseCurrency(str) {
  if (!str) return null;
  const match = String(str).match(/([0-9,]+(?:\.[0-9]{2})?)/);
  if (!match) return null;
  const n = parseFloat(match[1].replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

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

  const auctionIdMatch = text.match(/(?:Auction\s*ID|Item\s*#?):?\s*([0-9]+)/i) ||
    text.match(/\baid=["']?([0-9]+)["']?/i) ||
    text.match(/\bid=["']?(?:AITEM_|Auction_)([0-9]+)["']?/i);
  let auctionId = auctionIdMatch ? auctionIdMatch[1] : null;

  let caseNumber = null;
  let certificateNumber = null;
  let parcelId = null;
  let cleanAddress = null;
  let openingBid = null;
  let judgment = null;
  let assessed = null;
  let saleDate = options && options.saleDate ? options.saleDate : null;
  let homestead = null;
  let status = null;
  let cancellationReason = null;
  let priorPostponements = null;
  let statutoryStayExhausted = null;
  let plaintiff = null;
  let defendant = null;
  let attorney = null;
  let propType = null;

  // 1. Structured table extraction (ColdFusion ad_tab markup)
  if (text.includes('ad_tab') || text.includes('AD_LBL') || text.includes('AD_DTA')) {
    const fields = parseAdTabTable(text);

    const caseRaw = fields['case #'] || fields['case number'] || fields['case no.'] || fields['case'];
    if (caseRaw) {
      caseNumber = caseRaw.replace(/\s*\([0-9]+\)$/, '').trim();
    }
    certificateNumber = fields['certificate #'] || fields['tax cert #'] || fields['tax cert'] || fields['cert #'] || null;

    const parcelRaw = fields['parcel id'] || fields['apn'] || fields['parcel #'] || fields['folio'];
    if (parcelRaw && !/property\s*appraiser/i.test(parcelRaw)) {
      parcelId = parcelRaw;
    } else {
      const parcelUrlMatch = text.match(/ParcelID=([0-9A-Za-z\-_.]+)/i);
      if (parcelUrlMatch) parcelId = parcelUrlMatch[1];
    }

    let addrRaw = fields['property address'] || fields['address'];
    if (addrRaw) {
      addrRaw = addrRaw.replace(/\b(\d{5})0000\b/, '$1');
      cleanAddress = normalizeOcrText(addrRaw).replace(/\s+/g, ' ').replace(/\s+,/g, ',').trim();
    }

    openingBid = parseCurrency(fields['opening bid'] || fields['minimum bid'] || fields['starting bid'] || fields['upset bid']);
    assessed = parseCurrency(fields['appraised value'] || fields['assessed value']);
    judgment = parseCurrency(fields['final judgment amount'] || fields['final judgment'] || fields['judgment amount']);
    if (fields['auction date'] || fields['sale date']) {
      saleDate = fields['auction date'] || fields['sale date'];
    }
    status = fields['auction status'] || fields['status'] || null;
    plaintiff = fields['plaintiff'] || fields['plaintiff name'] || null;
    defendant = fields['defendant'] || fields['defendant name'] || null;
    attorney = fields['attorney'] || fields['attorney name'] || fields['attorney for plaintiff'] || null;
    propType = fields['property type'] || fields['prop type'] || null;
  }

  // 2. Regex fallback for fields not populated via table
  if (!caseNumber) {
    const caseMatch = text.match(/Case\s*(?:#|No\.?):?\s*([0-9A-Za-z\-_]+)/i);
    if (caseMatch) caseNumber = caseMatch[1];
  }
  if (!certificateNumber) {
    const certMatch = text.match(/Certificate\s*(?:#|No\.?):?\s*([0-9A-Za-z\-_]+)/i) ||
      text.match(/(?:Tax\s*Cert(?:ificate)?|Cert)\s*#?:?\s*([0-9A-Za-z\-_]+)/i);
    if (certMatch) certificateNumber = certMatch[1];
  }
  if (!parcelId) {
    const parcelMatch = text.match(/(?:Parcel\s*(?:ID|#?)|APN):?\s*([0-9A-Za-z\-_.]+)/i);
    if (parcelMatch && !/^(?:ID|APN)$/i.test(parcelMatch[1])) parcelId = parcelMatch[1];
  }
  if (!cleanAddress) {
    const addrMatch = text.match(/(?:Property\s*Address|Address):?\s*([^<\n\r]+)/i);
    if (addrMatch) {
      const rawAddr = addrMatch[1].replace(/<[^>]+>/g, '').trim();
      cleanAddress = normalizeOcrText(rawAddr).replace(/\s+/g, ' ').trim();
    }
  }
  if (openingBid == null) {
    const bidMatch = text.match(/(?:Opening\s*Bid|Minimum\s*Bid|Starting\s*Bid|Upset\s*Bid):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
    if (bidMatch) openingBid = parseFloat(bidMatch[1].replace(/,/g, ''));
  }
  if (judgment == null) {
    const judgmentMatch = text.match(/(?:Final\s*Judgment|Judgment\s*Amount):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
    if (judgmentMatch) judgment = parseFloat(judgmentMatch[1].replace(/,/g, ''));
  }
  if (assessed == null) {
    const assessedMatch = text.match(/(?:Appraised\s*Value|Assessed\s*Value):?\s*\$([0-9,]+(?:\.[0-9]{2})?)/i);
    if (assessedMatch) assessed = parseFloat(assessedMatch[1].replace(/,/g, ''));
  }
  if (!saleDate) {
    const dateMatch = text.match(/(?:Auction\s*Date|Sale\s*Date):?\s*([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);
    if (dateMatch) saleDate = dateMatch[1];
  }

  // Homestead Exemption
  if (!status) {
    const statusMatch = text.match(/(?:Auction\s*Status|Status):?\s*([A-Za-z0-9\s\-_.,]+?)(?:<|\n|\r|$)/i);
    if (statusMatch) status = statusMatch[1].trim();
  }
  if (!plaintiff) {
    const plMatch = text.match(/Plaintiff:?\s*([A-Za-z0-9\s\-_.,&]+?)(?:<|\n|\r|vs?\.?|Defendant)/i);
    if (plMatch) plaintiff = plMatch[1].trim();
  }
  if (!defendant) {
    const defMatch = text.match(/(?:Defendant|Def):?\s*([A-Za-z0-9\s\-_.,&]+?)(?:<|\n|\r|$)/i);
    if (defMatch) defendant = defMatch[1].trim();
  }
  if (!attorney) {
    const attyMatch = text.match(/Attorney:?\s*([A-Za-z0-9\s\-_.,&]+?)(?:<|\n|\r|$)/i);
    if (attyMatch) attorney = attyMatch[1].trim();
  }

  const combinedStatusText = `${status || ''} ${text}`;
  if (/bankruptcy|automatic\s*stay/i.test(combinedStatusText)) {
    statutoryStayExhausted = false;
    cancellationReason = 'Bankruptcy Stay';
    if (!status) status = 'Stayed - Bankruptcy';
  } else if (/stay(?:ed)?\b/i.test(combinedStatusText)) {
    statutoryStayExhausted = false;
    cancellationReason = 'Court Stay';
    if (!status) status = 'Stayed';
  } else if (/postpone|adjourn|continue/i.test(combinedStatusText)) {
    cancellationReason = 'Postponed';
    const priorMatch = text.match(/(?:postponed|adjourned)\s*\(?([0-9]+)\s*(?:times|x)?\)?/i);
    priorPostponements = priorMatch ? parseInt(priorMatch[1], 10) : 1;
    if (!status) status = 'Postponed';
  } else if (/cancel(?:ed|led)?|dismissed|withdrawn/i.test(combinedStatusText)) {
    cancellationReason = 'Canceled';
    if (!status) status = 'Canceled';
  }

  if (/Homestead(?:\s*Exemption)?\s*:\s*(?:Yes|True|Y)\b/i.test(text)) {
    homestead = true;
  } else if (/Homestead(?:\s*Exemption)?\s*:\s*(?:No|False|N)\b/i.test(text)) {
    homestead = false;
  }

  if (!caseNumber && !certificateNumber && !auctionId && !cleanAddress) {
    return null;
  }

  const zipMatch = cleanAddress ? cleanAddress.match(/\b\d{5}\b/) : null;
  const countyCapitalized = county.charAt(0).toUpperCase() + county.slice(1).toLowerCase();
  const cleanState = state.toUpperCase();

  return {
    source: 'sheriff',
    platform: options && options.mode === 'taxdeed' ? 'realtaxdeed' : 'realauction',
    county: countyCapitalized,
    state: cleanState,
    auctionId,
    caseNumber,
    certificateNumber,
    homestead,
    parcelId,
    address: cleanAddress,
    zip: zipMatch ? zipMatch[0] : null,
    openingBid,
    judgment,
    assessed,
    saleDate,
    status,
    cancellationReason,
    priorPostponements,
    statutoryStayExhausted,
    plaintiff,
    defendant,
    attorney,
    propType,
    cardHtml: text,
    sourceUrl: getRealAuctionUrl(county, state, {
      ...options,
      auctionId,
      caseNumber,
      certificateNumber,
    }),
  };
}

/**
 * Parses full RealAuction preview HTML docket
 */
function parseRealAuctionDocketHtml(html = '', county = 'cuyahoga', state = 'OH', options = {}) {
  let text = String(html || '');
  if (!text) return [];

  // Decode RealAuction ColdFusion macro compression if present
  if (/@(?:[A-L]|E_ITEM|E_STATS|E_DETAILS)/.test(text)) {
    text = decodeRealAuctionMacros(text);
  }

  const listings = [];

  // 1. Match AUCTION_ITEM cards or containers
  if (text.includes('AUCTION_ITEM')) {
    const parts = text.split(/<div\b(?=[^>]*\bclass="[^"]*AUCTION_ITEM)/i);
    for (let i = 1; i < parts.length; i++) {
      const cardHtml = '<div ' + parts[i];
      const parsed = parseRealAuctionCard(cardHtml, county, state, options);
      if (parsed && (parsed.caseNumber || parsed.certificateNumber || parsed.auctionId || parsed.address)) {
        listings.push(parsed);
      }
    }
  }

  // 2. Container regex for table-based dockets
  if (listings.length === 0) {
    const cardRegex = /<(?:div|table)\b[^>]*(?:class="[^"]*(?:Auction_W|tbl_list_data|AUCTION_ITEM)[^"]*"|id="[^"]*Auction_[0-9]+")[^>]*>([\s\S]*?)<\/(?:div|table)>/gi;
    let match;
    while ((match = cardRegex.exec(text)) !== null) {
      const cardHtml = match[1];
      const parsed = parseRealAuctionCard(cardHtml, county, state, options);
      if (parsed && (parsed.caseNumber || parsed.certificateNumber || parsed.auctionId || parsed.address)) {
        listings.push(parsed);
      }
    }
  }

  // 3. Fallback: Split on Case or Tax Cert markers
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
  decodeRealAuctionMacros,
  parseAdTabTable,
  getRealAuctionUrl,
  parseRealAuctionCard,
  parseRealAuctionDocketHtml,
};
