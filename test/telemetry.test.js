const assert = require('assert');
const { ScraperTelemetry } = require('../server/scrapers/telemetry');

async function runTelemetryTests() {
  console.log('--- Testing Scraper Telemetry ---');

  const telemetry = new ScraperTelemetry();

  // Test 1: Record successful run with perfect yield
  telemetry.recordRun('test-source', [
    { address: '123 Main St', openingBid: 100000, saleDate: '2024-01-01', photo: 'image.jpg' },
    { address: '456 Oak St', openingBid: 150000, saleDate: '2024-01-02', photo: 'image2.jpg' }
  ], 150, null);

  let report = telemetry.getHealthReport();
  assert.strictEqual(report.systemStatus, 'healthy');
  assert.strictEqual(report.details['test-source'].yieldMetrics.addressYieldPct, '100%');
  assert.strictEqual(report.details['test-source'].yieldMetrics.openingBidYieldPct, '100%');
  assert.strictEqual(report.details['test-source'].circuitBreakerTripped, false);
  console.log('✓ Perfect yield recorded correctly');

  // Test 2: Drop yield below threshold (Drift detection)
  // Second run has 0% address and opening bid yields
  telemetry.recordRun('test-source', [
    { address: '', openingBid: 0, saleDate: '2024-01-03', photo: 'image3.jpg' },
    { address: null, openingBid: null, saleDate: '2024-01-04', photo: 'image4.jpg' }
  ], 120, null);

  report = telemetry.getHealthReport();
  // Weight formula: (1.0 * 0.8) + (0.0 * 0.2) = 0.8 (80%)
  // Wait, let's just assert that it dropped.
  assert.strictEqual(report.details['test-source'].yieldMetrics.addressYieldPct, '80%');
  
  // Add more bad runs to trigger drift
  for (let i = 0; i < 5; i++) {
    telemetry.recordRun('test-source', [
      { address: '', openingBid: 0, saleDate: '2024-01-03', photo: 'image3.jpg' }
    ], 100, null);
  }

  report = telemetry.getHealthReport();
  assert.strictEqual(report.details['test-source'].driftDetected, true, 'Drift should be detected after repeated missing fields');
  assert.strictEqual(report.systemStatus, 'degraded', 'System status should be degraded due to drift');
  console.log('✓ Drift detection works for missing fields');

  // Test 3: Circuit breaker trip on consecutive errors
  const errorTelemetry = new ScraperTelemetry();
  errorTelemetry.recordRun('error-source', [], 0, new Error('Connection failed'));
  assert.strictEqual(errorTelemetry.getHealthReport().details['error-source'].circuitBreakerTripped, false);
  
  errorTelemetry.recordRun('error-source', [], 0, new Error('Connection failed'));
  errorTelemetry.recordRun('error-source', [], 0, new Error('Connection failed'));
  
  assert.strictEqual(errorTelemetry.getHealthReport().details['error-source'].circuitBreakerTripped, true, 'Breaker should trip after 3 errors');
  console.log('✓ Circuit breaker trips after 3 consecutive errors');

  console.log('All telemetry tests passed.\n');
}

if (require.main === module) {
  runTelemetryTests().catch(err => {
    console.error('Telemetry tests failed:', err);
    process.exit(1);
  });
}

module.exports = runTelemetryTests;
