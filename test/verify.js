const { execSync } = require('child_process');

console.log('====================================================');
console.log('🚀 PROPERTY_CRAWL — COMPLETE VERIFICATION LOOP');
console.log('====================================================\n');

const suites = [
  { name: '1. Client Unit & Formula Suite', cmd: 'node test/suite.test.js' },
  { name: '2. Backend REST API & Server Suite', cmd: 'node test/server.test.js' },
  { name: '3. Data Scrapers & Ingestion Pipeline', cmd: 'node test/scrapers.test.js' },
  { name: '4. AI Pipeline, Cost Tracker & Security', cmd: 'node test/ai.test.js' },
  { name: '5. E2E User Journey Emulation Suite', cmd: 'node test/e2e.test.js' },
  { name: '6. Hostile Security & Boundary Hardening', cmd: 'node test/hardening.test.js' },
  { name: '7. Source Registry Sync Drift (v0 <-> v2)', cmd: 'node test/sync.test.js' },
  { name: '8. Next.js 16 Production Build & TypeScript', cmd: 'npx next build' },
  { name: '9. Canonical Next Runtime Contract', cmd: 'node --test test/canonical-runtime.test.js' },
  { name: '10. Playwright Canonical UI Browser Suite', cmd: 'node test/run-ui-suite.js' }
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
    console.error(err.stdout ? err.stdout.toString() : err.message);
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
