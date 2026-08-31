const { telemetryInstance } = require('../scrapers/telemetry');

async function handleScrapers(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const method = req.method;

  if (method === 'GET' && url.pathname === '/api/scrapers/health') {
    const report = telemetryInstance.getHealthReport();
    return res.json(report);
  }

  res.status(404).json({ error: 'Scraper endpoint not found' });
}

module.exports = handleScrapers;
