'use strict';

/**
 * P0.6 Selector Drift & Extraction Yield Alarm.
 *
 * Monitors field extraction yield across scraped property records to immediately
 * detect DOM structure drift, broken CSS/XPath selectors, or upstream template changes.
 */

const DEFAULT_EXPECTED_FIELDS = [
  'id',
  'address',
  'saleDate',
  'openingBid',
  'county',
  'sourceUrl'
];

const DEFAULT_MIN_YIELD_THRESHOLD = 0.4; // Alarm triggers if yield drops below 40%
const DEFAULT_MAX_COLLAPSE_RATIO = 0.3;  // Alarm triggers if yield collapses by > 30% from baseline
const DEFAULT_HISTORICAL_BASELINE = 0.8;

function isFieldPresent(value) {
  if (value === null || value === undefined || value === '') return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/**
 * Compute extraction field yield for a single record against an expected fields list.
 *
 * @param {object} record - Scraped or parsed property record.
 * @param {string[]} [expectedFields=DEFAULT_EXPECTED_FIELDS] - Array of field keys expected.
 * @returns {{ yieldFraction: number, missingFields: string[], presentFields: string[], totalFields: number }}
 */
function computeFieldYield(record, expectedFields = DEFAULT_EXPECTED_FIELDS) {
  const fields = Array.isArray(expectedFields) && expectedFields.length > 0
    ? expectedFields
    : DEFAULT_EXPECTED_FIELDS;

  if (!record || typeof record !== 'object') {
    return {
      yieldFraction: 0,
      missingFields: [...fields],
      presentFields: [],
      totalFields: fields.length
    };
  }

  const missingFields = [];
  const presentFields = [];

  for (const field of fields) {
    if (isFieldPresent(record[field])) {
      presentFields.push(field);
    } else {
      missingFields.push(field);
    }
  }

  const yieldFraction = fields.length > 0
    ? (presentFields.length / fields.length)
    : 1;

  return {
    yieldFraction,
    missingFields,
    presentFields,
    totalFields: fields.length
  };
}

/**
 * Compute average field yield across a batch of property records.
 *
 * @param {object[]} records - Array of property records.
 * @param {string[]} [expectedFields] - Expected field keys.
 * @returns {{ meanYield: number, recordCount: number, recordYields: object[] }}
 */
function computeBatchYield(records, expectedFields = DEFAULT_EXPECTED_FIELDS) {
  const list = Array.isArray(records) ? records : [];
  if (list.length === 0) {
    return { meanYield: 0, recordCount: 0, recordYields: [] };
  }

  const recordYields = list.map((rec) => computeFieldYield(rec, expectedFields));
  const sumYield = recordYields.reduce((acc, curr) => acc + curr.yieldFraction, 0);
  const meanYield = sumYield / list.length;

  return {
    meanYield,
    recordCount: list.length,
    recordYields
  };
}

/**
 * Evaluate if a source has experienced selector or template drift based on current yield.
 * Emits a structured warning when yield collapses by >30% or drops below the minimum threshold (e.g. 0.4).
 *
 * @param {string} source - Source identifier (e.g. 'hud', 'sheriff', 'gsa').
 * @param {number} currentYield - Current extraction yield (0.0 to 1.0).
 * @param {number} [historicalYieldThreshold=0.8] - Baseline historical yield expected.
 * @param {object} [options={}] - Configurable thresholds (minThreshold, maxCollapseRatio).
 * @returns {{ hasDrift: boolean, warning?: string, source: string, currentYield: number, historicalYieldThreshold: number, collapseRatio: number, reason?: string }}
 */
function checkSelectorDrift(source, currentYield, historicalYieldThreshold = DEFAULT_HISTORICAL_BASELINE, options = {}) {
  const src = String(source || 'unknown').trim().toLowerCase();
  const env = options.env || process.env;
  const minThreshold = Number(options.minThreshold ?? env.SCRAPER_DRIFT_MIN_YIELD ?? DEFAULT_MIN_YIELD_THRESHOLD);
  const maxCollapseRatio = Number(options.maxCollapseRatio ?? env.SCRAPER_DRIFT_MAX_COLLAPSE ?? DEFAULT_MAX_COLLAPSE_RATIO);
  const baseline = Number.isFinite(Number(historicalYieldThreshold))
    ? Math.max(0, Math.min(1, Number(historicalYieldThreshold)))
    : DEFAULT_HISTORICAL_BASELINE;

  const current = Number.isFinite(Number(currentYield))
    ? Math.max(0, Math.min(1, Number(currentYield)))
    : 0;

  const collapseRatio = baseline > 0
    ? Math.max(0, (baseline - current) / baseline)
    : 0;

  const isCollapsed = collapseRatio > maxCollapseRatio;
  const isBelowFloor = current < minThreshold;
  const hasDrift = isCollapsed || isBelowFloor;

  if (!hasDrift) {
    return {
      hasDrift: false,
      source: src,
      currentYield: current,
      historicalYieldThreshold: baseline,
      collapseRatio
    };
  }

  const reason = isBelowFloor && isCollapsed
    ? 'CRITICAL_COLLAPSE_AND_SUB_FLOOR'
    : isBelowFloor
      ? 'BELOW_MIN_THRESHOLD'
      : 'YIELD_COLLAPSE';

  const warning = `SELECTOR_DRIFT_WARNING: Extraction yield for "${src}" dropped to ${(current * 100).toFixed(1)}% (baseline: ${(baseline * 100).toFixed(1)}%, collapse: ${(collapseRatio * 100).toFixed(1)}%, floor: ${(minThreshold * 100).toFixed(1)}%). Potential layout drift or selector failure.`;

  return {
    hasDrift: true,
    warning,
    source: src,
    currentYield: current,
    historicalYieldThreshold: baseline,
    collapseRatio,
    reason
  };
}

/**
 * Convenience helper to evaluate a batch of records directly for drift.
 */
function evaluateRecordsForDrift(source, records, expectedFields = DEFAULT_EXPECTED_FIELDS, historicalYieldThreshold = DEFAULT_HISTORICAL_BASELINE, options = {}) {
  const batch = computeBatchYield(records, expectedFields);
  const driftCheck = checkSelectorDrift(source, batch.meanYield, historicalYieldThreshold, options);
  return {
    ...driftCheck,
    recordCount: batch.recordCount
  };
}

module.exports = {
  computeFieldYield,
  computeBatchYield,
  checkSelectorDrift,
  evaluateRecordsForDrift,
  isFieldPresent,
  DEFAULT_EXPECTED_FIELDS,
  DEFAULT_MIN_YIELD_THRESHOLD,
  DEFAULT_MAX_COLLAPSE_RATIO,
  DEFAULT_HISTORICAL_BASELINE
};
