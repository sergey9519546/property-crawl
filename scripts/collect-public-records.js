#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { collectFloridaParcels, getAcsContext, buildPublicRecordEvidence } = require('../server/public-records');
const { buildAlachuaPilot } = require('../server/sources/alachua');

const HELP = `Collect bounded official public-record evidence.
  node scripts/collect-public-records.js --listing-id ID
  node scripts/collect-public-records.js --fl-county 11 --parcel-id 07702-000-000
  node scripts/collect-public-records.js --fl-county 11 --limit 25 --pages 2
  node scripts/collect-public-records.js --acs-geoid 12001000200 --year 2024
  node scripts/collect-public-records.js --state-fips 12 --county-fips 001 --year 2024
  node scripts/collect-public-records.js --alachua-intake intake_ID [--lookup-parcels] [--store FILE] [--limit 5]

Census estimates use CENSUS_API_KEY. Florida county numbers are DOR codes, not FIPS.
--output FILE writes an evidence JSON artifact; default prints JSON. Every collection
is bounded, and hasMore means additional records were not collected.
`;

function parseArgs(argv) {
  const allowed = new Set(['--listing-id', '--fl-county', '--parcel-id', '--limit', '--pages', '--acs-geoid', '--year', '--state-fips', '--county-fips', '--output', '--alachua-intake', '--store']);
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help') return { help: true };
    if (argv[i] === '--lookup-parcels') { options['lookup-parcels'] = true; continue; }
    if (!allowed.has(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown or incomplete option. Use --help.');
    options[argv[i].slice(2)] = argv[++i];
  }
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !argv.length) { process.stdout.write(HELP); return; }
  const modes = [
    Boolean(args['alachua-intake']),
    Boolean(args['listing-id']),
    Boolean(args['fl-county']),
    Boolean(args['acs-geoid'] || (args['state-fips'] && args['county-fips'])),
  ];
  if (modes.filter(Boolean).length !== 1) throw new Error('Choose exactly one workflow: --alachua-intake, --listing-id, --fl-county, --acs-geoid, or state/county FIPS.');
  let result;
  if (args['alachua-intake']) {
    const allowed = new Set(['alachua-intake', 'lookup-parcels', 'store', 'limit', 'output']);
    if (Object.keys(args).some(key => !allowed.has(key))) throw new Error('The Alachua pilot accepts only --store, --limit, --output, and optional --lookup-parcels.');
    const maxParcelLookups = args.limit == null ? 5 : Number(args.limit);
    if (!Number.isSafeInteger(maxParcelLookups) || maxParcelLookups < 1 || maxParcelLookups > 20) throw new Error('Alachua --limit must be an integer from 1 through 20.');
    result = await buildAlachuaPilot(args['alachua-intake'], { storePath: args.store, allowNetwork: args['lookup-parcels'] === true, maxParcelLookups });
  } else if (args['listing-id']) {
    const db = require('../server/db/client');
    const listing = await db.getListingById(args['listing-id']);
    if (!listing) throw new Error('Listing not found.');
    result = await buildPublicRecordEvidence(listing, { allowNetwork: true, acsYear: args.year || 2024 });
  } else if (args['fl-county']) {
    result = await collectFloridaParcels({ countyNo: args['fl-county'], parcelId: args['parcel-id'], pageSize: args.limit || 25 }, { maxPages: args.pages || 1, maxRecords: 500 });
  } else if (args['acs-geoid'] || (args['state-fips'] && args['county-fips'])) {
    result = await getAcsContext({ geoid: args['acs-geoid'], stateFips: args['state-fips'], countyFips: args['county-fips'] }, { acsYear: args.year || 2024 });
  } else throw new Error('Choose --alachua-intake, --listing-id, --fl-county, --acs-geoid, or state/county FIPS.');
  const body = JSON.stringify(result, null, 2) + '\n';
  if (args.output) {
    const target = path.resolve(args.output);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    try { fs.writeFileSync(temporary, body, { flag: 'wx', mode: 0o600 }); fs.renameSync(temporary, target); }
    finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    process.stdout.write(`Saved ${target}\n`);
  } else process.stdout.write(body);
}

if (require.main === module) main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
module.exports = { parseArgs, main };
