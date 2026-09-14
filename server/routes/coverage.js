// server/routes/coverage.js
//
// HTTP wrapper for the per-state coverage matrix.
// GET /api/coverage -> { catalog: {...}, catalogByState: {...}, liveByState: {...}, states: [...] }
//
// The matrix is computed from the in-memory catalog + the local live cache;
// it never hits the network.

const { summarize } = require('../discovery/coverage-matrix');

async function handleCoverage(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const matrix = summarize();
    return res.json(matrix);
  } catch (error) {
    return res.status(503).json({ error: error.message || 'Coverage matrix unavailable' });
  }
}

module.exports = handleCoverage;