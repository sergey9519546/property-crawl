'use strict';

/**
 * Geometric validation & ranking for street-level imagery candidates
 * (Google Street View metadata, Panoramax STAC, Mapillary Graph API).
 */

const EARTH_RADIUS_METERS = 6371000;
const DEFAULT_MAX_DIRECTIONAL_DISTANCE_METERS = 45;
const DEFAULT_MIN_DIRECTIONAL_DISTANCE_METERS = 3;
const DEFAULT_MAX_ANGULAR_ERROR_DEGREES = 65;
const DEFAULT_MAX_360_RADIUS_METERS = 80;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeBearing(deg) {
  return ((deg % 360) + 360) % 360;
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const aLat = toFiniteNumber(lat1);
  const aLng = toFiniteNumber(lng1);
  const bLat = toFiniteNumber(lat2);
  const bLng = toFiniteNumber(lng2);
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;

  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLng = Math.sin(dLng / 2);
  const a = sinHalfLat * sinHalfLat
    + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * sinHalfLng * sinHalfLng;
  return EARTH_RADIUS_METERS * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDegrees(fromLat, fromLng, toLat, toLng) {
  const aLat = toFiniteNumber(fromLat);
  const aLng = toFiniteNumber(fromLng);
  const bLat = toFiniteNumber(toLat);
  const bLng = toFiniteNumber(toLng);
  if (aLat === null || aLng === null || bLat === null || bLng === null) return null;

  const phi1 = (aLat * Math.PI) / 180;
  const phi2 = (bLat * Math.PI) / 180;
  const dLon = ((bLng - aLng) * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2)
    - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return normalizeBearing((Math.atan2(y, x) * 180) / Math.PI);
}

function angularDiffDegrees(a, b) {
  const na = toFiniteNumber(a);
  const nb = toFiniteNumber(b);
  if (na === null || nb === null) return null;
  const diff = Math.abs(normalizeBearing(na - nb));
  return diff > 180 ? 360 - diff : diff;
}

function is360Candidate(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  if (candidate.is360 === true || candidate.isPano === true || candidate.is_pano === true) return true;
  const fov = toFiniteNumber(candidate.fieldOfView ?? candidate.field_of_view ?? candidate.fov);
  return fov !== null && fov >= 270;
}

/**
 * Evaluates whether a street-level photo candidate plausibly depicts the target property.
 * - 360 panoramas are accepted anywhere inside the provider radius.
 * - Flat directional images must be within [minDirectionalDistanceMeters, maxDirectionalDistanceMeters]
 *   ([3m, 45m] default), carry a finite camera azimuth, and point within 65 degrees of target bearing.
 */
function evaluateStreetCandidate(candidate, target, options = {}) {
  const candLat = toFiniteNumber(candidate?.lat ?? candidate?.latitude);
  const candLng = toFiniteNumber(candidate?.lng ?? candidate?.longitude);
  const tgtLat = toFiniteNumber(target?.lat ?? target?.latitude);
  const tgtLng = toFiniteNumber(target?.lng ?? target?.longitude);
  const is360 = is360Candidate(candidate);

  if (candLat === null || candLng === null || tgtLat === null || tgtLng === null) {
    return {
      ok: false,
      reason: 'missing_coordinates',
      is360,
      distanceMeters: null,
      targetHeading: null,
      cameraAzimuth: null,
      angularErrorDeg: null,
    };
  }

  const dist = Number(distanceMeters(candLat, candLng, tgtLat, tgtLng).toFixed(1));
  const cameraAzimuth = toFiniteNumber(
    candidate?.azimuth
    ?? candidate?.compassAngle
    ?? candidate?.compass_angle
    ?? candidate?.heading
  );
  const targetHeading = dist >= 0.5
    ? Math.round(bearingDegrees(candLat, candLng, tgtLat, tgtLng))
    : null;

  if (is360) {
    const maxRadius = toFiniteNumber(options.maxDistanceMeters ?? options.radiusMeters)
      ?? DEFAULT_MAX_360_RADIUS_METERS;
    if (dist > maxRadius) {
      return {
        ok: false,
        reason: 'exceeds_provider_radius',
        is360: true,
        distanceMeters: dist,
        targetHeading,
        cameraAzimuth,
        angularErrorDeg: null,
      };
    }
    return {
      ok: true,
      reason: null,
      is360: true,
      distanceMeters: dist,
      targetHeading,
      cameraAzimuth,
      angularErrorDeg: null,
    };
  }

  const maxDirectionalDist = toFiniteNumber(options.maxDirectionalDistanceMeters)
    ?? DEFAULT_MAX_DIRECTIONAL_DISTANCE_METERS;
  const minDirectionalDist = toFiniteNumber(options.minDirectionalDistanceMeters)
    ?? DEFAULT_MIN_DIRECTIONAL_DISTANCE_METERS;
  const maxAngularError = toFiniteNumber(options.maxAngularErrorDegrees)
    ?? DEFAULT_MAX_ANGULAR_ERROR_DEGREES;

  if (dist > maxDirectionalDist) {
    return {
      ok: false,
      reason: 'directional_too_far',
      is360: false,
      distanceMeters: dist,
      targetHeading,
      cameraAzimuth,
      angularErrorDeg: targetHeading !== null && cameraAzimuth !== null
        ? Math.round(angularDiffDegrees(cameraAzimuth, targetHeading))
        : null,
    };
  }

  if (dist < minDirectionalDist) {
    return {
      ok: false,
      reason: 'directional_too_close_degenerate_bearing',
      is360: false,
      distanceMeters: dist,
      targetHeading,
      cameraAzimuth,
      angularErrorDeg: null,
    };
  }

  if (cameraAzimuth === null) {
    return {
      ok: false,
      reason: 'directional_azimuth_missing',
      is360: false,
      distanceMeters: dist,
      targetHeading,
      cameraAzimuth: null,
      angularErrorDeg: null,
    };
  }

  const exactTargetBearing = bearingDegrees(candLat, candLng, tgtLat, tgtLng);
  const angularErr = angularDiffDegrees(cameraAzimuth, exactTargetBearing);
  if (angularErr === null || angularErr > maxAngularError) {
    return {
      ok: false,
      reason: 'directional_facing_away',
      is360: false,
      distanceMeters: dist,
      targetHeading,
      cameraAzimuth,
      angularErrorDeg: angularErr !== null ? Number(angularErr.toFixed(1)) : null,
    };
  }

  return {
    ok: true,
    reason: null,
    is360: false,
    distanceMeters: dist,
    targetHeading,
    cameraAzimuth,
    angularErrorDeg: Number(angularErr.toFixed(1)),
  };
}

function captureTimestampMs(candidate) {
  const raw = candidate?.captureDate ?? candidate?.capturedAt ?? candidate?.captured_at ?? null;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * Evaluates and ranks accepted street-view candidates:
 * 1) 360 panoramas before flat directional photos
 * 2) Shorter effective distance (plus small angular-error penalty for directional photos)
 * 3) Newer capture date
 */
function rankStreetCandidates(candidates, target, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0) return [];
  const accepted = [];
  for (const cand of candidates) {
    if (!cand || typeof cand !== 'object') continue;
    const evaluation = evaluateStreetCandidate(cand, target, options);
    if (!evaluation.ok) continue;
    accepted.push({
      candidate: cand,
      evaluation,
      penaltyMeters: evaluation.distanceMeters
        + (evaluation.is360 ? 0 : (evaluation.angularErrorDeg || 0) * 0.2),
      capturedMs: captureTimestampMs(cand),
    });
  }

  accepted.sort((a, b) => {
    if (a.evaluation.is360 !== b.evaluation.is360) {
      return a.evaluation.is360 ? -1 : 1;
    }
    if (Math.abs(a.penaltyMeters - b.penaltyMeters) > 0.5) {
      return a.penaltyMeters - b.penaltyMeters;
    }
    if (a.capturedMs !== b.capturedMs) {
      return b.capturedMs - a.capturedMs;
    }
    return a.evaluation.distanceMeters - b.evaluation.distanceMeters;
  });

  return accepted.map(({ candidate, evaluation }) => ({
    ...candidate,
    distanceMeters: evaluation.distanceMeters,
    is360: evaluation.is360,
    targetHeading: evaluation.targetHeading,
    cameraAzimuth: evaluation.cameraAzimuth,
    angularErrorDeg: evaluation.angularErrorDeg,
  }));
}

module.exports = {
  DEFAULT_MAX_DIRECTIONAL_DISTANCE_METERS,
  DEFAULT_MIN_DIRECTIONAL_DISTANCE_METERS,
  DEFAULT_MAX_ANGULAR_ERROR_DEGREES,
  DEFAULT_MAX_360_RADIUS_METERS,
  distanceMeters,
  bearingDegrees,
  angularDiffDegrees,
  is360Candidate,
  evaluateStreetCandidate,
  rankStreetCandidates,
};
