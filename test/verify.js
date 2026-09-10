const { execSync } = require('child_process');

// An immutable test build must not overwrite the developer's running .next.
process.env.NEXT_VERIFY_BUILD = '1';

console.log('====================================================');
console.log('🚀 PROPERTY_CRAWL — COMPLETE VERIFICATION LOOP');
console.log('====================================================\n');

const suites = [
  { name: '1. Client Unit & Formula Suite', cmd: 'node test/suite.test.js' },
  { name: '2. Backend REST API & Server Suite', cmd: 'node test/server.test.js' },
  { name: '3. Data Scrapers & Ingestion Pipeline', cmd: 'node test/scrapers.test.js' },
  { name: '3a. Scraper Reliability, CivilView, Durable Live Records & Build-Data Publication Gate', cmd: 'node --test test/scraper-reliability.test.js test/civilview.test.js test/live-record-store.test.js test/build-data-gate.test.js' },
  { name: '3b. Exact Source Links & Structured Data Safety', cmd: 'node --experimental-strip-types --test test/source-integrity.test.mjs' },
  { name: '3c. Evidence-Only Enrichment, Exports, Underwriting, Legal Rules & CORS', cmd: 'node --test test/cors-policy.test.js test/enrich-evidence.test.js test/export-truth.test.js test/underwriting-truth.test.mjs test/legal-rules-truth.test.js' },
  { name: '3d. Verified Property Media & Street View Fallback', cmd: 'node --test test/property-image.test.js test/publisher-media.test.js test/secondary-property-media.test.js test/gsa-usda-publisher-gallery.test.js' },
  { name: '3e. Canonical Listing API Transport', cmd: 'node --test test/property-api.test.mjs test/workspace-session.test.mjs' },
  { name: '3f. Inventory, Source Record Groups and Saved Search Workflows', cmd: 'node --test test/workspace-flows.test.mjs test/listing-record-groups.test.mjs' },
  { name: '3g. Verified Map Locations & Coincident Source Records', cmd: 'node --test test/listing-map-policy.test.js' },
  { name: '3h. Discovery Coverage, Collection Gates & Transport Failures', cmd: 'node --test test/discovery-coverage.test.js test/hunts-paged-aggregate.test.js test/source-network-release-gate.test.js test/scraper-transport-errors.test.js' },
  { name: '4. AI Pipeline, Cost Tracker & Security', cmd: 'node test/ai.test.js' },
  { name: '5. E2E User Journey Emulation Suite', cmd: 'node test/e2e.test.js' },
  { name: '6. Hostile Security & Boundary Hardening', cmd: 'node test/hardening.test.js' },
  { name: '7. Source Registry Sync Drift (v0 <-> v2)', cmd: 'node test/sync.test.js' },
  { name: '8. DB Row Shape & Types Contract', cmd: 'node test/db.test.js' },
  { name: '9. Next.js 16 Production Build & TypeScript', cmd: 'npx next build' },
  { name: '10. Canonical Next Runtime Contract', cmd: 'node --test test/canonical-runtime.test.js' },
  { name: '11. Playwright Canonical UI Browser Suite', cmd: 'node test/run-ui-suite.js' },
  { name: '12. Adversary Acceptance Suite (Scenarios 1–10)', cmd: 'node test/adversary.test.js' },
  { name: '13. Autonomous Bidding & MAO Simulator', cmd: 'node test/bidding.test.js' },
  { name: '14. Scraper Telemetry & Drift Detection', cmd: 'node test/telemetry.test.js' },
  { name: '15. Agent System Acceptance (Adversary Scenarios 1–10)', cmd: 'node --test test/agent-system.test.js' },
  { name: '16. Commands Config-under-Test', cmd: 'node --test test/commands.test.js' },
  { name: '17. Agents Config-under-Test', cmd: 'node --test test/agents.test.js' },
  { name: '18. Source Network, Catalog & Live Ingestion Suite', cmd: 'npm run test:sources' },
  { name: '19. Property Intelligence & Saved Hunts Suite', cmd: 'npm run test:intelligence' },
  { name: '20. Capability Graph & Typed Dispatch Suite (Tier 3.3)', cmd: 'node --test test/capability-graph.test.js' },
  { name: '21. Opportunity Signals & v0 DB Seeder Suite (Priority Upgrade 3 & Task 3.1)', cmd: 'node --test test/signals.test.js test/seed-from-v0.test.js' }
];

let totalPassed = 0;
let totalFailed = 0;

for (const suite of suites) {
  console.log(`Running ${suite.name}...`);
  try {
    const output = execSync(suite.cmd, { stdio: 'pipe' }).toString();
    console.log(output);
    totalPassed++;
  } catch (err) {
    console.error(`FAILED: ${suite.name}`);
    if (err.stdout) console.error(err.stdout.toString());
    if (err.stderr) console.error(err.stderr.toString());
    if (!err.stdout && !err.stderr) console.error(err.message);
    totalFailed++;
  }
}

console.log('====================================================');
console.log(`VERIFICATION RESULT: ${totalPassed}/${suites.length} Suites Passed (${totalFailed} Failed)`);
console.log('====================================================');

if (totalFailed > 0) {
  process.exit(1);
} else {
  console.log('✅ ALL PRODUCTION QUALITY GATES & VERIFICATION CHECKS PASSED!');
  process.exit(0);
}
