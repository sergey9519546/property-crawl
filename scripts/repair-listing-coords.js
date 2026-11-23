#!/usr/bin/env node
'use strict';

/**
 * Bounded CLI to audit and repair corrupted / missing listing coordinates
 * in a snapshot/live JSON cache using shared state-bounds guards and the
 * US Census Geocoder (with SHA-256 disk caching).
 *
 * Defaults to --dry-run (zero mutations, zero network calls unless --apply
 * and --geocode-limit N are explicitly requested).
 */

const fs = require('node:fs');
const path = require('node:path');
const { isCoordInStateBounds, detectCoincidentCoordPoison } = require('../server/geo/state-bounds');
const { parseStructuredExpectedAddress, geocodeExactAddress } = require('../server/enrichment/geocoder');
const { detectDuplicatePhotoUrls } = require('../server/scrapers/media-policy');

function parseArgs(argv) {
  const args = {
    input: path.resolve(__dirname, '../.cache/live-listings.json'),
    apply: false,
    dryRun: true,
    geocodeLimit: 0,
    sleepMs: 150,
  };
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (token === '--dry-run') {
      args.dryRun = true;
      args.apply = false;
    } else if (token === '--input' && argv[i + 1]) {
      args.input = path.resolve(argv[++i]);
    } else if (token === '--geocode-limit' && argv[i + 1]) {
      args.geocodeLimit = Math.max(0, Math.min(2000, Math.floor(Number(argv[++i]) || 0)));
    } else if (token === '--sleep-ms' && argv[i + 1]) {
      args.sleepMs = Math.max(0, Math.min(5000, Math.floor(Number(argv[++i]) || 0)));
    }
  }
  return args;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(opts.input)) {
    console.error(JSON.stringify({ ok: false, error: `Input file not found: ${opts.input}` }));
    process.exit(1);
  }

  const rawText = fs.readFileSync(opts.input, 'utf8');
  const parsed = JSON.parse(rawText);
  const isArray = Array.isArray(parsed);
  const listings = isArray ? parsed : (Array.isArray(parsed?.listings) ? parsed.listings : null);
  if (!listings) {
    console.error(JSON.stringify({ ok: false, error: 'Unsupported JSON payload shape (expected array or { listings: [] })' }));
    process.exit(1);
  }

  const poisonedKeys = detectCoincidentCoordPoison(listings, { minDistinctBuildings: 3 });
  const duplicatePhotos = detectDuplicatePhotoUrls(listings, { minDistinctBuildings: 3 });

  const telemetry = {
    mode: opts.dryRun ? 'dry-run' : 'apply',
    input: opts.input,
    totalListings: listings.length,
    validCoords: 0,
    missingCoords: 0,
    geocodableMissing: 0,
    ungeocodableMissing: 0,
    outOfStateRemoved: 0,
    nullIslandOrInvalidRemoved: 0,
    poisonRemoved: 0,
    missingProvenanceCoordinatesCount: 0,
    coincidentPoisonGroups: poisonedKeys.size,
    duplicatePhotoGroups: duplicatePhotos.size,
    geocodedApplied: 0,
    geocodeFailed: 0,
    sampleOutOfState: [],
  };

  let remainingGeocodeBudget = opts.apply ? opts.geocodeLimit : 0;

  for (let i = 0; i < listings.length; i++) {
    const item = listings[i];
    if (!item || typeof item !== 'object') continue;
    const state = typeof item.state === 'string' ? item.state.trim().toUpperCase() : '';
    const hasLat = item.lat != null && item.lat !== '';
    const hasLng = item.lng != null && item.lng !== '';

    if (hasLat && hasLng) {
      const lat = Number(item.lat);
      const lng = Number(item.lng);
      const coordKey = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)},${lng.toFixed(5)}` : null;

      let rejectReason = null;
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
        rejectReason = 'coordinates_missing_or_invalid';
        telemetry.nullIslandOrInvalidRemoved += 1;
      } else if (state) {
        const boundsCheck = isCoordInStateBounds(lat, lng, state);
        if (!boundsCheck.ok) {
          rejectReason = boundsCheck.reason;
          telemetry.outOfStateRemoved += 1;
          if (telemetry.sampleOutOfState.length < 10) {
            telemetry.sampleOutOfState.push({
              id: item.id,
              source: item.source,
              state,
              lat,
              lng,
              reason: boundsCheck.reason,
            });
          }
        }
      }

      if (!rejectReason && coordKey && poisonedKeys.has(coordKey)) {
        rejectReason = 'coincident_coord_poison';
        telemetry.poisonRemoved += 1;
      }

      if (rejectReason) {
        if (!opts.dryRun) {
          item.lat = null;
          item.lng = null;
          const prov = item.provenance && typeof item.provenance === 'object' ? { ...item.provenance } : {};
          delete prov.coordinates;
          prov.coordinatesRejected = { lat, lng, state: state || null, reason: rejectReason };
          item.provenance = prov;
        }
      } else {
        telemetry.validCoords += 1;
        if (!item.provenance?.coordinates) {
          telemetry.missingProvenanceCoordinatesCount += 1;
        }
        continue;
      }
    }

    telemetry.missingCoords += 1;
    const expected = parseStructuredExpectedAddress(item);
    if (!expected) {
      telemetry.ungeocodableMissing += 1;
      continue;
    }
    telemetry.geocodableMissing += 1;

    if (remainingGeocodeBudget > 0) {
      remainingGeocodeBudget -= 1;
      const result = await geocodeExactAddress(expected);
      if (result && Number.isFinite(result.lat) && Number.isFinite(result.lng)) {
        item.lat = result.lat;
        item.lng = result.lng;
        const prov = item.provenance && typeof item.provenance === 'object' ? { ...item.provenance } : {};
        prov.derivedFields = { ...(prov.derivedFields || {}), geocode: true };
        prov.coordinates = {
          provider: result.source || 'US_CENSUS_GEOCODER',
          precision: result.precision || 'street_interpolated',
          matchedAddress: result.matchedAddress,
          verifiedAt: new Date().toISOString(),
        };
        delete prov.coordinatesRejected;
        item.provenance = prov;
        telemetry.geocodedApplied += 1;
      } else {
        telemetry.geocodeFailed += 1;
      }
      if (!result?.cached) {
        await sleep(opts.sleepMs);
      }
    }
  }

  if (!opts.dryRun) {
    const tmpPath = `${opts.input}.${process.pid}.tmp`;
    const outPayload = isArray ? listings : { ...parsed, listings };
    fs.writeFileSync(tmpPath, JSON.stringify(outPayload), 'utf8');
    fs.renameSync(tmpPath, opts.input);
    telemetry.written = true;
  } else {
    telemetry.written = false;
  }

  console.log(JSON.stringify(telemetry, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
