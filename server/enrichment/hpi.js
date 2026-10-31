'use strict';

/**
 * server/enrichment/hpi.js
 *
 * Bridge and re-export for FHFA House Price Index benchmarks.
 */

const fhfaHpi = require('../intelligence/fhfa-hpi');

module.exports = {
  ...fhfaHpi,
};
