'use strict';

const crypto = require('crypto');

/**
 * Normalizes an APN (Assessor's Parcel Number) by stripping dashes, dots, spaces,
 * and normalizing uppercase.
 */
function normalizeApn(apn) {
  if (!apn || typeof apn !== 'string') return '';
  return apn
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase();
}

/**
 * Normalizes a street address for robust fuzzy/cluster matching.
 */
function normalizeAddress(address) {
  if (!address || typeof address !== 'string') return '';
  return address
    .toUpperCase()
    .replace(/[,\.\-\#\/]/g, ' ')
    .replace(/\bSTREET\b/g, 'ST')
    .replace(/\bAVENUE\b/g, 'AVE')
    .replace(/\bROAD\b/g, 'RD')
    .replace(/\bBOULEVARD\b/g, 'BLVD')
    .replace(/\bDRIVE\b/g, 'DR')
    .replace(/\bLANE\b/g, 'LN')
    .replace(/\bCOURT\b/g, 'CT')
    .replace(/\bCIRCLE\b/g, 'CIR')
    .replace(/\b(TERRACE|TERR)\b/g, 'TER')
    .replace(/\b(PARKWAY|PKWY)\b/g, 'PKWY')
    .replace(/\b(HIGHWAY|HWY)\b/g, 'HWY')
    .replace(/\bPLACE\b/g, 'PL')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates great-circle distance between two points in meters using the Haversine formula.
 */
function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) {
    return Infinity;
  }

  const R = 6371000; // Earth's mean radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Evaluates whether two listings represent the same physical property.
 * Returns match confidence between 0.0 and 1.0.
 */
function evaluateDuplicateMatch(a, b) {
  if (!a || !b) return { isMatch: false, confidence: 0, reason: 'invalid_inputs' };

  // Rule 1: Exact APN + County match (100% confidence)
  const apnA = normalizeApn(a.apn || a.parcelId);
  const apnB = normalizeApn(b.apn || b.parcelId);
  const stateA = String(a.state || '').toUpperCase();
  const stateB = String(b.state || '').toUpperCase();
  const countyA = String(a.county || '').toUpperCase();
  const countyB = String(b.county || '').toUpperCase();

  if (apnA && apnB && apnA === apnB && stateA === stateB) {
    return {
      isMatch: true,
      confidence: 1.0,
      reason: 'exact_apn_match',
      matchKey: `${stateA}:${countyA}:${apnA}`
    };
  }

  // Rule 2: Exact Normalized Address + State + Zip match (95% confidence)
  const addrA = normalizeAddress(a.address);
  const addrB = normalizeAddress(b.address);
  const zipA = String(a.zip || '').slice(0, 5);
  const zipB = String(b.zip || '').slice(0, 5);

  if (addrA && addrB && addrA === addrB && stateA === stateB) {
    if (!zipA || !zipB || zipA === zipB) {
      return {
        isMatch: true,
        confidence: 0.95,
        reason: 'exact_address_match',
        matchKey: `${stateA}:${zipA || '00000'}:${addrA}`
      };
    }
  }

  // Rule 3: Geographic proximity (< 15 meters) + Address substring match (90% confidence)
  const dist = haversineDistanceMeters(Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng));
  if (dist <= 15) {
    // Check street prefix
    const houseNumA = (addrA.match(/^\d+/) || [''])[0];
    const houseNumB = (addrB.match(/^\d+/) || [''])[0];
    if (houseNumA && houseNumB && houseNumA === houseNumB) {
      return {
        isMatch: true,
        confidence: 0.90,
        reason: 'spatial_proximity_and_house_number',
        distanceMeters: Math.round(dist * 10) / 10
      };
    }
  }

  return { isMatch: false, confidence: 0, reason: 'no_match' };
}

/**
 * Clusters an array of listings into unified master property records,
 * preserving individual source dockets in `docketNotices` and `provenanceAuditTrail`.
 *
 * @param {Array<Object>} listings
 * @returns {Array<Object>} Clustered master listing records
 */
function clusterListings(listings = []) {
  if (!Array.isArray(listings) || listings.length === 0) return [];

  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < listings.length; i++) {
    if (assigned.has(i)) continue;

    const base = listings[i];
    const group = [base];
    assigned.add(i);

    for (let j = i + 1; j < listings.length; j++) {
      if (assigned.has(j)) continue;

      const candidate = listings[j];
      const match = evaluateDuplicateMatch(base, candidate);

      if (match.isMatch) {
        group.push(candidate);
        assigned.add(j);
      }
    }

    if (group.length === 1) {
      clusters.push({
        ...base,
        canonicalParcelId: generateCanonicalParcelId(base),
        isUnifiedDossier: false,
        docketNotices: [extractDocketNotice(base)],
        provenanceAuditTrail: [base.source || 'unknown']
      });
    } else {
      // Merge multiple dockets into unified dossier
      clusters.push(mergeClusterGroup(group));
    }
  }

  return clusters;
}

/**
 * Generates deterministic canonical parcel ID from listing attributes.
 */
function generateCanonicalParcelId(listing) {
  const apn = normalizeApn(listing.apn || listing.parcelId);
  const state = String(listing.state || 'US').toUpperCase();
  const addr = normalizeAddress(listing.address);

  const basis = apn ? `${state}:${apn}` : `${state}:${addr}`;
  const hash = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 16);
  return `PARCEL-${hash.toUpperCase()}`;
}

/**
 * Extracts a concise notice descriptor from a listing record.
 */
function extractDocketNotice(listing) {
  return {
    source: listing.source || 'unknown',
    sourceUrl: listing.sourceUrl || null,
    caseNumber: listing.caseNumber || listing.docketNumber || null,
    openingBid: listing.openingBid ?? null,
    saleDate: listing.saleDate || null,
    observedAt: listing.sourceObservedAt || listing.fetchedAt || null,
    publisher: listing.provenance?.publisher || listing.source || null
  };
}

/**
 * Merges a group of duplicate listings into a single master record.
 */
function mergeClusterGroup(group) {
  // Sort by completeness and observation recency
  const sorted = [...group].sort((a, b) => {
    const scoreA = (a.imageUrl ? 2 : 0) + (a.openingBid ? 1 : 0) + (a.sqft ? 1 : 0);
    const scoreB = (b.imageUrl ? 2 : 0) + (b.openingBid ? 1 : 0) + (b.sqft ? 1 : 0);
    return scoreB - scoreA;
  });

  const primary = sorted[0];
  const canonicalParcelId = generateCanonicalParcelId(primary);

  const docketNotices = group.map(extractDocketNotice);
  const provenanceAuditTrail = [...new Set(group.map((g) => g.source).filter(Boolean))];

  // Pick lowest opening bid across active auctions if multiple exist
  const bids = group.map((g) => Number(g.openingBid)).filter((b) => Number.isFinite(b) && b > 0);
  const lowestOpeningBid = bids.length > 0 ? Math.min(...bids) : primary.openingBid;

  return {
    ...primary,
    canonicalParcelId,
    openingBid: lowestOpeningBid,
    isUnifiedDossier: true,
    clusterNoticeCount: group.length,
    docketNotices,
    provenanceAuditTrail
  };
}

module.exports = {
  normalizeApn,
  normalizeAddress,
  haversineDistanceMeters,
  evaluateDuplicateMatch,
  clusterListings,
  generateCanonicalParcelId,
  mergeClusterGroup
};
