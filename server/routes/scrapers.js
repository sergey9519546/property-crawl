const { telemetryInstance } = require('../scrapers/telemetry');
const scheduler = require('../scrapers/scheduler');

async function handleScrapers(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET' && (url.pathname === '/api/scrapers/health' || url.pathname === '/api/scrapers')) {
    const report = telemetryInstance.getHealthReport();
    return res.json(report);
  }

  if (method === 'POST' && (url.pathname === '/api/scrapers/run' || url.pathname === '/api/scrapers')) {
    const runPromise = scheduler.runAll();
    // If client requested non-blocking trigger
    if (req.headers && req.headers['x-async'] === 'true') {
      runPromise.catch(err => console.error('[Scrapers Route] Async run error:', err));
      return res.json({ status: 'triggered', message: 'Ingestion cycle running in background' });
    }
    const result = await runPromise;
    return res.json({ status: 'completed', result });
  }

  res.status(404).json({ error: 'Scraper endpoint not found' });
}

module.exports = handleScrapers;

