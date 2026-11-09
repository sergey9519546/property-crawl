'use strict';

/**
 * server/seo/index.js
 *
 * Server-side Programmatic SEO and Statutory Intelligence entrypoint.
 * Provides canonical statutory schedules, metadata helpers, and schema generators.
 */

const countySeo = require('../../src/lib/county-seo.js');

module.exports = {
  ...countySeo,
};
