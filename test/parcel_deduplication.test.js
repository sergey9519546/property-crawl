'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeApn,
  normalizeAddress,
  haversineDistanceMeters,
  evaluateDuplicateMatch,
  clusterListings,
  generateCanonicalParcelId
} = require('../server/intelligence/deduplication');

test('Deduplication: normalizes APNs and addresses accurately', () => {
  assert.equal(normalizeApn('04120-105.001-A'), '04120105001A');
  assert.equal(normalizeApn('  39-102-445  '), '39102445');

  assert.equal(
    normalizeAddress('124 Elm Street, Apt 2, Camden, NJ'),
    '124 ELM ST APT 2 CAMDEN NJ'
  );
  assert.equal(
    normalizeAddress('500 North Boulevard Ave.'),
    '500 NORTH BLVD AVE'
  );
});

test('Deduplication: computes Haversine distance in meters', () => {
  // Same coordinate
  assert.equal(haversineDistanceMeters(40.7128, -74.0060, 40.7128, -74.0060), 0);

  // ~111 meters apart (0.001 deg latitude delta)
  const dist = haversineDistanceMeters(40.7128, -74.0060, 40.7138, -74.0060);
  assert.ok(dist > 100 && dist < 120, `Distance should be ~111m, got ${dist}`);
});

test('Deduplication: evaluates duplicate match rules', () => {
  // Case 1: Exact APN match across different source formats
  const matchApn = evaluateDuplicateMatch(
    { apn: '04-123-456', state: 'NJ', county: 'Camden' },
    { parcelId: '04123456', state: 'NJ', county: 'Camden' }
  );
  assert.equal(matchApn.isMatch, true);
  assert.equal(matchApn.reason, 'exact_apn_match');
  assert.equal(matchApn.confidence, 1.0);

  // Case 2: Exact Address match
  const matchAddr = evaluateDuplicateMatch(
    { address: '742 Evergreen Terrace', state: 'IL', zip: '62704' },
    { address: '742 Evergreen Terr.', state: 'IL', zip: '62704' }
  );
  assert.equal(matchAddr.isMatch, true);
  assert.equal(matchAddr.reason, 'exact_address_match');

  // Case 3: Spatial proximity (< 15 meters) with same house number
  const matchSpatial = evaluateDuplicateMatch(
    { lat: 39.9250, lng: -75.1190, address: '88 Market St', state: 'NJ' },
    { lat: 39.92505, lng: -75.11905, address: '88 Market Street Unit 1', state: 'NJ' }
  );
  assert.equal(matchSpatial.isMatch, true);
  assert.equal(matchSpatial.reason, 'spatial_proximity_and_house_number');

  // Case 4: Different properties
  const noMatch = evaluateDuplicateMatch(
    { apn: '111', address: '100 Main St', state: 'OH' },
    { apn: '222', address: '999 Elm Rd', state: 'OH' }
  );
  assert.equal(noMatch.isMatch, false);
});

test('Deduplication: merges multi-source docket notices into unified master dossier', () => {
  const notices = [
    {
      id: 'SHERIFF-NJ-CAM-101',
      source: 'civilview',
      state: 'NJ',
      county: 'Camden',
      address: '450 Federal St, Camden, NJ 08103',
      apn: '08-0105-0012',
      openingBid: 85000,
      saleDate: '2026-10-25',
      caseNumber: 'F-001234-24'
    },
    {
      id: 'B4A-NJ-CAM-992',
      source: 'bid4assets',
      state: 'NJ',
      county: 'Camden',
      address: '450 Federal Street, Camden, NJ 08103',
      apn: '0801050012',
      openingBid: 79000, // Lender lowered opening bid on auction marketplace
      saleDate: '2026-10-25',
      imageUrl: 'https://bid4assets.com/photos/450federal.jpg'
    },
    {
      id: 'LEGAL-NJ-PRESS-77',
      source: 'email_legal_notice',
      state: 'NJ',
      county: 'Camden',
      address: '450 Federal St, Camden, NJ',
      apn: '08-0105-0012',
      saleDate: '2026-10-25',
      caseNumber: 'F-001234-24'
    }
  ];

  const clustered = clusterListings(notices);

  assert.equal(clustered.length, 1, 'All 3 source records must collapse into 1 master dossier');
  const master = clustered[0];

  assert.equal(master.isUnifiedDossier, true);
  assert.equal(master.clusterNoticeCount, 3);
  assert.equal(master.openingBid, 79000, 'Must select the lowest confirmed opening bid');
  assert.equal(master.imageUrl, 'https://bid4assets.com/photos/450federal.jpg');
  assert.ok(master.canonicalParcelId.startsWith('PARCEL-'));

  // Verify docket notices array preserves all 3 source provenances
  assert.equal(master.docketNotices.length, 3);
  assert.deepEqual(master.provenanceAuditTrail.sort(), ['bid4assets', 'civilview', 'email_legal_notice'].sort());
});
