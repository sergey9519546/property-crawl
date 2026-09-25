'use strict';

// server/routes/portfolio-dashboard.js
//
// GET /api/portfolio/dashboard — single endpoint that aggregates the
// user's saved listings (the watchlist) into a roll-up payload the
// portfolio view renders. Read-only; gated by the workspace-identity
// helper so the saved-listings layer enforces auth.
//
// Query params:
//   upcomingWindowDays  — window for upcomingSales (1..180, default 30)
//   upcomingLimit       — cap on upcomingSales entries (0..50, default 5)

const db = require('../db/client');
const { computePortfolioDashboard } = require('../intelligence/portfolio-dashboard');
const { requireWorkspaceIdentity } = require('../security/workspace-identity');

function defaultIdentity(req, res) {
  return requireWorkspaceIdentity(req, res);
}

function boundedInt(raw, fallback, min, max) {
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return fallback;
  if (n < min || n > max) return fallback;
  return n;
}

async function loadSavedListings(database, userId) {
  if (!userId || !database) return [];
  const saved = await database.getSavedDeals(userId);
  return Array.isArray(saved) ? saved : [];
}

function serializeDashboard(dashboard) {
  return {
    userId: dashboard.userId,
    count: dashboard.count,
    totalEstimatedValue: dashboard.totalEstimatedValue,
    totalEstimatedEquity: dashboard.totalEstimatedEquity,
    medianOpeningBid: dashboard.medianOpeningBid === null ? null : Number(dashboard.medianOpeningBid.toFixed(2)),
    medianMid: dashboard.medianMid === null ? null : Number(dashboard.medianMid.toFixed(2)),
    medianDealScore: dashboard.medianDealScore,
    medianDiscount: dashboard.medianDiscount,
    perState: dashboard.perState,
    perSource: dashboard.perSource,
    perPropType: dashboard.perPropType,
    upcomingSales: dashboard.upcomingSales.map((l) => ({
      id: l.id,
      source: l.source,
      state: l.state,
      city: l.city,
      address: l.address,
      saleDate: l.saleDate,
      openingBid: l.openingBid,
      mid: l.mid,
      dealScore: l.dealScore,
      propType: l.propType
    })),
    missing: dashboard.missing,
    generatedAt: dashboard.generatedAt
  };
}

function createPortfolioDashboardHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const identity = dependencies.requireWorkspaceIdentity || defaultIdentity;
  const now = typeof dependencies.now === 'function'
    ? dependencies.now
    : (dependencies.now ? () => dependencies.now : () => Date.now());

  return async function handlePortfolioDashboard(req, res, urlInput) {
    if (String(req?.method || '').toUpperCase() !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Allow', 'GET');
      return res.json({ error: 'method_not_allowed' });
    }

    const url = urlInput instanceof URL ? urlInput : new URL(req.url, 'http://localhost');
    if (url.pathname !== '/api/portfolio/dashboard') {
      return res.status(404).json({ error: 'not_found' });
    }

    const userId = identity(req, res);
    if (!userId) return;

    const upcomingWindowDays = boundedInt(url.searchParams.get('upcomingWindowDays'), 30, 1, 180);
    const upcomingLimit = boundedInt(url.searchParams.get('upcomingLimit'), 5, 0, 50);

    const savedListings = await loadSavedListings(database, userId);
    const dashboard = computePortfolioDashboard(savedListings, {
      userId,
      upcomingWindowDays,
      upcomingLimit,
      nowMs: now()
    });

    res.setHeader('Cache-Control', 'no-store');
    return res.json({
      schema: 'property-crawl.portfolio-dashboard/v1',
      ...serializeDashboard(dashboard)
    });
  };
}

module.exports = {
  createPortfolioDashboardHandler,
  serializeDashboard
};