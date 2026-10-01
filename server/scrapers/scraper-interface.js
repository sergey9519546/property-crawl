'use strict';

// server/scrapers/scraper-interface.js
//
// The adapter contract that server/scrapers/scheduler.js read but never
// declared.
//
// The scheduler drives every scraper adapter it runs through exactly nine
// members (extracted from `scraper.<member>` reads in scheduler.js and
// server/sources/collection-coordinator.js). Nothing in the repo declared that
// contract, so drift degraded silently instead of failing:
//
//   - a catalog adapterKey stopped matching any sourceKey and nothing said so;
//   - getRawPublisherRecord existed on only some adapters, and the scheduler's
//     `typeof scraper.getRawPublisherRecord === 'function'` fallback wrote the
//     DERIVED normalized listing into discovery_snapshots.raw_payload, labelling
//     it publisher-observed (migration 016).
//
// This module is shape-only and dependency-free. It never calls scrapeFeed:
// validation must stay side-effect free because adapters perform network I/O.

/**
 * The nine members the scheduler requires of every adapter it runs, in the
 * order the scheduler first reads them.
 *
 * Required here means "the scheduler reads this member", NOT "every member is
 * present on every adapter" - see RULE NOTES below. The read site is named for
 * each so a future rename cannot silently leave a phantom requirement behind.
 */
const REQUIRED_SCRAPER_MEMBERS = Object.freeze([
  // scheduler.js circuitBreaker.isOpen() - refuse ingestion after an open breaker.
  'circuitBreaker',
  // scheduler.js `scraper.fixtureOnly === true` - refuse production ingestion.
  'fixtureOnly',
  // scheduler.js getRawPublisherRecord(item) - publisher-observed raw_payload.
  'getRawPublisherRecord',
  // scheduler.js `scraper.historicalOnly === true` - refuse live ingestion.
  'historicalOnly',
  // scheduler.js sanitizeRunReport(scraper.lastRunReport) + continuation cursor.
  'lastRunReport',
  // scheduler.js log lines, telemetry.recordRun(scraper.name, ...).
  'name',
  // scheduler.js `await scraper.scrapeFeed()` - must resolve to an array.
  'scrapeFeed',
  // scheduler.js setCheckpoint(cursor) - resume pagination across runs.
  'setCheckpoint',
  // scheduler.js realScraperKeys / beginRun / finishRun / validation expectedSource.
  'sourceKey',
]);

// RULE NOTES - why the nine are not all presence-required:
//
// The scheduler reads only three members unguarded: sourceKey, name and
// scrapeFeed. Breaking any of those crashes the cycle or silently misroutes a
// run, so they are hard requirements.
//
// The remaining six are each read behind a truthiness or `typeof` guard, which
// makes ABSENCE a legal, deliberate state that the scheduler already handles:
//
//   circuitBreaker          absent => no breaker, run proceeds
//   fixtureOnly             absent => not fixture-only (only trustee.js sets it)
//   historicalOnly          absent => not historical-only (only fdic.js sets it)
//   setCheckpoint           absent => no resume (only hud.js + servicelink.js)
//   lastRunReport           absent => report null; sanitizeRunReport(undefined)
//                            returns a neutral coverage object, so this is safe
//   getRawPublisherRecord   absent => NOT safe. The scheduler falls back to
//                            JSON.parse(listing.raw) and writes derived data into
//                            the publisher-raw column. Required for every adapter
//                            the scheduler actually ingests from.
//
// So: presence is required for the members whose absence the scheduler cannot
// compensate for, and TYPE conformance is required for the members it reads
// defensively. A declared member is satisfied by a function or a defined
// non-null property; state fields that legitimately start null (lastRunReport)
// or false (fixtureOnly, historicalOnly) pass on the null/false value itself.
//
// Exactly ONE rule per member, so a single defect is reported once.

// The scheduler throws before ingestion for these two, so they never reach the
// publisher-record fallback and are exempt from it.
function skipsIngestion(scraper) {
  return scraper.fixtureOnly === true || scraper.historicalOnly === true;
}

function label(scraper, index) {
  if (scraper && typeof scraper === 'object') {
    if (typeof scraper.name === 'string' && scraper.name.trim()) return scraper.name;
    if (typeof scraper.sourceKey === 'string' && scraper.sourceKey.trim()) return scraper.sourceKey;
  }
  return `#${index}`;
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasIsOpen(value) {
  return (typeof value === 'object' && value !== null) || typeof value === 'function'
    ? typeof value.isOpen === 'function'
    : false;
}

/**
 * Validate one scraper adapter against the scheduler's contract.
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateScraperAdapter(scraper) {
  const errors = [];

  if (scraper === null || typeof scraper !== 'object' || Array.isArray(scraper)) {
    return { ok: false, errors: ['scraper adapter must be an object'] };
  }

  // A missing name/sourceKey is covered by the non-empty-string rule below:
  // undefined and null fail it, so a second presence check would double-report.
  if (!isNonEmptyString(scraper.name)) {
    errors.push('name must be a non-empty string (used for logs, telemetry and run history)');
  }

  if (!isNonEmptyString(scraper.sourceKey)) {
    errors.push('sourceKey must be a non-empty string (used for run identity, checkpoints and expectedSource)');
  }

  // A fixture-only adapter is refused before scrapeFeed is ever called
  // (FIXTURE_ONLY_SCRAPER), so it legitimately has nothing to run. trustee.js
  // implements scrapeFeed anyway; the exemption is for adapters that do not.
  // A scrapeFeed that EXISTS but is not callable is always wrong.
  if (typeof scraper.scrapeFeed !== 'function') {
    if (!(scraper.scrapeFeed === undefined && scraper.fixtureOnly === true)) {
      errors.push('scrapeFeed must be a function (the scheduler awaits it and requires an array back)');
    }
  }

  // Type conformance for the defensively-read members. Absence is legal; a
  // wrong-typed value is not, because it silently disables the guard.
  if ('circuitBreaker' in scraper && scraper.circuitBreaker != null && !hasIsOpen(scraper.circuitBreaker)) {
    errors.push('circuitBreaker, when declared, must expose an isOpen() function');
  }
  if ('setCheckpoint' in scraper && scraper.setCheckpoint != null && typeof scraper.setCheckpoint !== 'function') {
    errors.push('setCheckpoint, when declared, must be a function');
  }
  if ('fixtureOnly' in scraper && scraper.fixtureOnly != null && typeof scraper.fixtureOnly !== 'boolean') {
    errors.push('fixtureOnly, when declared, must be a boolean');
  }
  if ('historicalOnly' in scraper && scraper.historicalOnly != null && typeof scraper.historicalOnly !== 'boolean') {
    errors.push('historicalOnly, when declared, must be a boolean');
  }
  if ('lastRunReport' in scraper && scraper.lastRunReport != null && typeof scraper.lastRunReport !== 'object') {
    errors.push('lastRunReport, when declared, must be an object or null');
  }

  // The publisher record is the one absence the scheduler cannot compensate
  // for: without it, derived data is written into the publisher-raw column.
  if (typeof scraper.getRawPublisherRecord !== 'function' && !skipsIngestion(scraper)) {
    errors.push(
      'getRawPublisherRecord must be a function; without it the scheduler writes derived listing data into the publisher-raw column'
    );
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate a whole fleet at once. Errors are prefixed with the adapter's
 * identity so one offender in twenty-four is still identifiable.
 *
 * @returns {{ ok: boolean, errors: string[] }}
 */
function validateScraperAdapters(list) {
  if (!Array.isArray(list)) {
    return { ok: false, errors: ['scraper adapters must be provided as an array'] };
  }
  const errors = [];
  list.forEach((scraper, index) => {
    for (const message of validateScraperAdapter(scraper).errors) {
      errors.push(`${label(scraper, index)}: ${message}`);
    }
  });
  return { ok: errors.length === 0, errors };
}

module.exports = {
  REQUIRED_SCRAPER_MEMBERS,
  validateScraperAdapter,
  validateScraperAdapters,
};
