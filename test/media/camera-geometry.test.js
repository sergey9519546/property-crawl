'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  distanceMeters,
  bearingDegrees,
  angularDiffDegrees,
  evaluateStreetCandidate,
  rankStreetCandidates,
} = require('../../server/media/camera-geometry');

test('distanceMeters, bearingDegrees, and angularDiffDegrees compute accurate geodesic metrics', () => {
  const same = distanceMeters(40.95, -74.03, 40.95, -74.03);
  assert.equal(same, 0);

  // Moving south -> camera at north pointing south (~180°)
  const bearingSouth = bearingDegrees(40.9502, -74.03, 40.95, -74.03);
  assert.ok(Math.abs(bearingSouth - 180) < 0.5, `Expected ~180°, got ${bearingSouth}`);

  // Moving east -> camera at west pointing east (~90°)
  const bearingEast = bearingDegrees(40.95, -74.0303, 40.95, -74.03);
  assert.ok(Math.abs(bearingEast - 90) < 0.5, `Expected ~90°, got ${bearingEast}`);

  // Modular wrap-around across 0°/360°
  assert.equal(angularDiffDegrees(355, 5), 10);
  assert.equal(angularDiffDegrees(5, 355), 10);
  assert.equal(angularDiffDegrees(0, 180), 180);
  assert.equal(angularDiffDegrees(null, 90), null);
});

test('evaluateStreetCandidate gates flat directional imagery on distance [3m, 45m], azimuth presence, and <= 65 deg cone', () => {
  const target = { lat: 40.95, lng: -74.03 };

  // ~22m north of target facing south (180°) -> valid
  const aligned = evaluateStreetCandidate({ lat: 40.9502, lng: -74.03, azimuth: 172, is360: false }, target);
  assert.equal(aligned.ok, true);
  assert.ok(aligned.distanceMeters > 15 && aligned.distanceMeters < 30);
  assert.ok(aligned.angularErrorDeg <= 10);

  // Same spot facing north (0° / 355° away from property) -> rejected
  const facingAway = evaluateStreetCandidate({ lat: 40.9502, lng: -74.03, azimuth: 355, is360: false }, target);
  assert.equal(facingAway.ok, false);
  assert.equal(facingAway.reason, 'directional_facing_away');

  // Directional photo missing azimuth -> rejected
  const noAzimuth = evaluateStreetCandidate({ lat: 40.9502, lng: -74.03, azimuth: null, is360: false }, target);
  assert.equal(noAzimuth.ok, false);
  assert.equal(noAzimuth.reason, 'directional_azimuth_missing');

  // Directional photo > 45m -> rejected (~66m north)
  const tooFar = evaluateStreetCandidate({ lat: 40.9506, lng: -74.03, azimuth: 180, is360: false }, target);
  assert.equal(tooFar.ok, false);
  assert.equal(tooFar.reason, 'directional_too_far');

  // Directional photo < 3m (degenerate bearing) -> rejected
  const tooClose = evaluateStreetCandidate({ lat: 40.95001, lng: -74.03, azimuth: 180, is360: false }, target);
  assert.equal(tooClose.ok, false);
  assert.equal(tooClose.reason, 'directional_too_close_degenerate_bearing');

  // 360 panorama at 40m with null azimuth -> accepted within radius
  const pano = evaluateStreetCandidate({ lat: 40.95036, lng: -74.03, field_of_view: 360, azimuth: null }, target, { radiusMeters: 60 });
  assert.equal(pano.ok, true);
  assert.equal(pano.is360, true);

  // 360 panorama beyond provider radius -> rejected
  const farPano = evaluateStreetCandidate({ lat: 40.951, lng: -74.03, is360: true }, target, { radiusMeters: 50 });
  assert.equal(farPano.ok, false);
  assert.equal(farPano.reason, 'exceeds_provider_radius');
});

test('rankStreetCandidates excludes off-axis directional shots and prefers 360 panoramas over flat frames', () => {
  const target = { lat: 40.95, lng: -74.03 };
  const ranked = rankStreetCandidates([
    { id: 'away', lat: 40.95015, lng: -74.03, azimuth: 0, is360: false, capturedAt: '2026-01-01T00:00:00Z' },
    { id: 'flat-aligned', lat: 40.95015, lng: -74.03, azimuth: 180, is360: false, capturedAt: '2026-02-01T00:00:00Z' },
    { id: 'pano-360', lat: 40.95025, lng: -74.03, azimuth: null, is360: true, capturedAt: '2025-05-01T00:00:00Z' },
  ], target, { radiusMeters: 80 });

  assert.deepEqual(ranked.map((r) => r.id), ['pano-360', 'flat-aligned']);
  assert.equal(ranked[0].targetHeading, 180);
});
