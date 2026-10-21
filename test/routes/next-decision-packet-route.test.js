'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('Next.js Decision Packet Route: generates public JSON packet for valid listing', async () => {
  const { buildDecisionPacket } = require('../../server/export/decision-packet');
  const db = require('../../server/db/client');
  
  let sample = (await db.getListings({ limit: 1 })).listings[0];
  if (!sample) {
    const fallback = {
      id: 'SHERIFF-OH-CUY-4401',
      address: '1420 W 28th St',
      city: 'Cleveland',
      state: 'OH',
      county: 'Cuyahoga',
      zip: '44113',
      propType: 'Single Family',
      openingBid: 55000,
      caseNumber: 'CV-24-887123',
      saleDate: '2026-11-15',
      plaintiff: 'Wells Fargo Bank, N.A.',
      deposit: 5000,
      source: 'sheriff',
    };
    if (typeof db.createListing === 'function') {
      try {
        await db.createListing(fallback);
      } catch {}
    }
    sample = (await db.getListings({ limit: 1 })).listings[0] || fallback;
  }
  assert.ok(sample, 'Must have at least one listing');

  const packet = buildDecisionPacket(sample, {});
  assert.equal(packet.schemaVersion, 'decision-packet/v1');
  assert.equal(packet.property.id, sample.id);
  assert.ok(packet.underwriting);
  assert.ok(packet.underwriting.titleRisk);
  assert.ok(packet.underwriting.cashToClose);
});

test('Next.js Decision Packet Route: generates Markdown dossier for format=markdown', async () => {
  const { buildDecisionPacket, formatDecisionPacketMarkdown } = require('../../server/export/decision-packet');
  const db = require('../../server/db/client');
  
  let sample = (await db.getListings({ limit: 1 })).listings[0];
  if (!sample) {
    sample = {
      id: 'SHERIFF-OH-CUY-4401',
      address: '1420 W 28th St',
      city: 'Cleveland',
      state: 'OH',
      county: 'Cuyahoga',
      zip: '44113',
      propType: 'Single Family',
      openingBid: 55000,
      caseNumber: 'CV-24-887123',
      saleDate: '2026-11-15',
      plaintiff: 'Wells Fargo Bank, N.A.',
      deposit: 5000,
      source: 'sheriff',
    };
  }
  const packet = buildDecisionPacket(sample, {});
  const md = formatDecisionPacketMarkdown(packet);
  
  assert.ok(md.includes('# FORECLOSURE DUE DILIGENCE DECISION PACKET'));
  assert.ok(md.includes('Statutory Title Risk & Lien Survival Matrix'));
  assert.ok(md.includes(sample.id));
});
