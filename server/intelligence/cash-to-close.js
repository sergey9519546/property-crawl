'use strict';

/**
 * server/intelligence/cash-to-close.js
 *
 * Canonical implementation merged into server/ai/legal-rules.js (I16).
 * Re-exported here so existing callers and test contracts remain unchanged.
 */

const {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
} = require('../ai/legal-rules');

module.exports = {
  JURISDICTION_FEE_SCHEDULES,
  calculateCompleteCashToClose,
};
