'use strict';

/**
 * Shared lastRunReport helpers for HTML/API scrapers that historically
 * collapsed upstream failures into an empty array.
 */

function createRunReport(sourceKey, scope = {}) {
  return {
    sourceKey,
    outcome: 'running',
    scope,
    statesRequested: [],
    statesSucceeded: [],
    statesFailed: [],
    endpointsTried: 0,
    endpointsSucceeded: 0,
    recordsDiscovered: 0,
    recordsEmitted: 0,
    recordsRejected: 0,
    failures: [],
    complete: false,
    fullSweepComplete: false,
    truncated: false,
    fixtureFallbackUsed: false,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };
}

function recordUnitFailure(report, unit, error, kind = 'upstream') {
  if (!report) return;
  if (unit && !report.statesFailed.includes(unit)) report.statesFailed.push(unit);
  report.failures.push({
    unit: unit || null,
    kind,
    message: String(error?.message || error || 'unknown failure').slice(0, 300),
  });
}

function recordUnitSuccess(report, unit, count = 0) {
  if (!report) return;
  if (unit && !report.statesSucceeded.includes(unit)) report.statesSucceeded.push(unit);
  report.endpointsSucceeded += 1;
  report.recordsDiscovered += count;
}

function finalizeRunReport(report, { emitted = 0, rejected = 0 } = {}) {
  if (!report) return null;
  report.recordsEmitted = emitted;
  report.recordsRejected = rejected;
  report.finishedAt = new Date().toISOString();
  const requested = (report.statesRequested || []).length;
  const succeeded = (report.statesSucceeded || []).length;
  const failed = (report.statesFailed || []).length;
  if (requested > 0 && succeeded === 0 && failed > 0) {
    report.outcome = 'failed';
    report.complete = false;
  } else if (failed > 0 && succeeded > 0) {
    report.outcome = 'partial_failure';
    report.complete = false;
  } else if (emitted === 0 && succeeded > 0 && failed === 0) {
    // Every requested unit completed; inventory was genuinely empty.
    report.outcome = 'empty';
    report.complete = true;
  } else if (requested > 0 && succeeded === requested) {
    report.outcome = 'success';
    report.complete = true;
  } else if (failed === 0) {
    report.outcome = 'success';
    report.complete = true;
  } else {
    report.outcome = 'partial_failure';
  }
  report.fullSweepComplete = report.complete && failed === 0;
  return report;
}

/**
 * True when HTML looks like a client-rendered shell (React/Next/Angular/Vue
 * bootstrap) without recognizable listing-card markup. An HTTP 200 SPA shell
 * is not proof of empty inventory.
 */
function looksLikeClientRenderedShell(html) {
  const s = String(html || '');
  if (!s.trim()) return false;
  const spaMarkers = [
    /id\s*=\s*["']root["']/i,
    /id\s*=\s*["']app["']/i,
    /id\s*=\s*["']__next["']/i,
    /data-reactroot/i,
    /__NEXT_DATA__/,
    /ng-app/i,
    /data-v-[0-9a-f]{8}/i,
  ];
  const listingMarkers = [
    /property-card/i,
    /property-item/i,
    /property-row/i,
    /property-address/i,
    /SaleDetails/i,
    /asset-details/i,
    /opening\s+bid/i,
  ];
  return spaMarkers.some((re) => re.test(s)) && !listingMarkers.some((re) => re.test(s));
}

/**
 * When every requested unit "succeeds" with zero records but HTML samples
 * look like SPA shells (or every unit failed transport), do not claim empty
 * inventory — mark observation_error / failed.
 */
function applyEmptyInventoryHonesty(report, { emitted = 0, htmlSamples = [], throwOnUnresolved = true, sourceKey = '' } = {}) {
  if (!report) return null;
  if (emitted > 0) {
    report.observationError = null;
    return report;
  }
  const spaHits = htmlSamples.filter((html) => looksLikeClientRenderedShell(html)).length;
  const emptySuccess = (report.statesSucceeded || []).length > 0 && (report.statesFailed || []).length === 0 && emitted === 0;
  if (spaHits > 0 && emptySuccess) {
    report.outcome = 'observation_error';
    report.complete = false;
    report.fullSweepComplete = false;
    report.observationError = `${sourceKey || report.sourceKey}: ${spaHits} HTTP 200 response(s) looked like client-rendered shells without parseable listing cards — not verified empty inventory`;
    report.failures.push({
      unit: null,
      kind: 'spa_shell_empty',
      message: report.observationError.slice(0, 300),
    });
  } else if (emptySuccess && htmlSamples.length > 0 && spaHits === htmlSamples.length) {
    report.outcome = 'observation_error';
    report.complete = false;
    report.fullSweepComplete = false;
    report.observationError = `${sourceKey || report.sourceKey}: all HTML samples lacked parseable listing markers`;
  }
  if (throwOnUnresolved && report.outcome === 'observation_error') {
    const error = new Error(report.observationError || 'Collection returned unverified empty inventory');
    error.code = 'SOURCE_OBSERVATION_ERROR';
    error.lastRunReport = report;
    throw error;
  }
  return report;
}

module.exports = {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
  looksLikeClientRenderedShell,
  applyEmptyInventoryHonesty,
};
