// server/routes/coverage.js
//
// HTTP wrapper for the per-state coverage matrix.
// GET /api/coverage -> { catalog: {...}, catalogByState: {...}, liveByState: {...}, states: [...] }
//
// The catalog half is computed in memory. The live half reads Postgres when the
// listing store is Postgres (production), else the local live record store.
// It never hits the network.

const db = require('../db/client');
const { summarizeWithDatabase } = require('../discovery/coverage-matrix');

async function handleCoverage(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const matrix = await summarizeWithDatabase(db);
    return res.json(matrix);
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Coverage matrix unavailable' });
  }
}

module.exports = handleCoverage;
