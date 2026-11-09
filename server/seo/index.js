'use strict';

/**
 * server/seo/index.js
 *
 * Server-side Programmatic SEO and Statutory Intelligence entrypoint.
 * Provides canonical statutory schedules, metadata helpers, schema generators,
 * and automated search engine indexing pings.
 */

const countySeo = require('../../src/lib/county-seo.js');
const indexingPing = require('./indexing-ping.js');

module.exports = {
  ...countySeo,
  ...indexingPing,
};
