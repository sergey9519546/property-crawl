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

module.exports = {
  createRunReport,
  recordUnitFailure,
  recordUnitSuccess,
  finalizeRunReport,
};
