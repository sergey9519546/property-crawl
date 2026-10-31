'use strict';

/**
 * server/routes/decision-packet.js
 *
 * Programmatic Underwriting & Decision Packet REST API endpoint:
 *   GET  /api/listings/:id/packet
 *   GET  /api/listings/:id/decision-packet
 *   POST /api/listings/:id/packet (with operator overrides in body)
 *
 * Supported query parameters:
 *   format: 'json' (default) | 'markdown' | 'md'
 *   disposition: 'BID' | 'PASS' | 'UNDERWRITE'
 *   maxAllowableOffer: number
 *   operatorNotes: string
 *   operatorId: string
 *   registrationFunds, creditedDeposit, buyersPremium, sheriffPoundage,
 *   transferTax, delinquentTaxes, settlementCosts: numbers
 *
 * Protected by RBAC permission: 'canExportDossier' (operator and analyst roles).
 * Fails closed with 503 when no operator token is configured, mirroring the
 * other operator surfaces (hunts, document-review, enrichment).
 */

const db = require('../db/client');
const { buildDecisionPacket, formatDecisionPacketMarkdown } = require('../export/decision-packet');
const { hasPermission } = require('../security/auth');
const { presentedRunToken, tokensMatch } = require('./scrapers');
const { resolveOperatorToken, operatorTokenConfigured } = require('../security/operator-token');

function extractCookie(req, name) {
  const cookieHeader = req.headers && req.headers.cookie;
  if (!cookieHeader || typeof cookieHeader !== 'string') return null;
  const match = cookieHeader.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function resolveRequestAuth(req, env = process.env) {
  const configuredToken = resolveOperatorToken(env);
  let presented = presentedRunToken(req);
  if (!presented) {
    presented = extractCookie(req, 'pp_operator_session') || extractCookie(req, 'workspace_session');
  }

  if (!presented) {
    return { authenticated: false, role: null, reason: 'missing_credentials' };
  }

  // 1. Direct match with configured operator secret
  if (configuredToken && tokensMatch(presented, configuredToken)) {
    return { authenticated: true, role: 'operator' };
  }

  // 2. Prefixed token with configured secret (e.g. "analyst:SECRET", "viewer:SECRET")
  if (configuredToken) {
    const prefixMatch = presented.match(/^(operator|analyst|viewer)[:._/-](.+)$/i);
    if (prefixMatch && tokensMatch(prefixMatch[2], configuredToken)) {
      return { authenticated: true, role: prefixMatch[1].toLowerCase() };
    }
    // Check JSON token payload: {"role":"analyst","secret":"..."}
    try {
      const parsed = JSON.parse(presented);
      if (parsed.secret && tokensMatch(parsed.secret, configuredToken)) {
        const candidateRole = String(parsed.role || 'operator').toLowerCase();
        return { authenticated: true, role: candidateRole };
      }
    } catch {}
    // If an operator secret is required and none of the forms matched: fail closed
    return { authenticated: false, role: null, reason: 'invalid_credentials' };
  }

  // 3. No operator token configured: fail closed. Operator surfaces require
  // SCRAPER_ADMIN_TOKEN (or PROPERTY_OPERATOR_SECRET); the route maps this case
  // to 503 (see handleDecisionPacket), mirroring hunts/document-review/enrichment.
  return {
    authenticated: false,
    role: null,
    reason: 'operator_token_not_configured',
    requiredConfiguration: 'SCRAPER_ADMIN_TOKEN',
  };
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const CASH_OVERRIDE_FIELDS = [
  'registrationFunds',
  'creditedDeposit',
  'buyersPremium',
  'sheriffPoundage',
  'transferTax',
  'delinquentTaxes',
  'settlementCosts',
];

async function handleDecisionPacket(req, res, url, dependencies = {}) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed. Use GET or POST to export decision packets.' });
  }

  // Extract listing ID from path: /api/listings/:id/packet or /api/listings/:id/decision-packet
  const match = url.pathname.match(/^\/api\/listings\/(.+?)\/(?:packet|decision-packet)$/);
  if (!match || !match[1]) {
    return res.status(400).json({ error: 'Invalid decision packet endpoint format' });
  }

  let id;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return res.status(400).json({ error: 'Invalid listing identifier encoding' });
  }

  if (id.length > 256 || /[\/\\\u0000-\u001f\u007f]/.test(id)) {
    return res.status(400).json({ error: 'Invalid listing identifier' });
  }

  // Operator token must be configured: operator surfaces fail closed with 503
  // when SCRAPER_ADMIN_TOKEN (or PROPERTY_OPERATOR_SECRET) is unset - mirrors
  // hunts.js / document-review.js / enrichment.js.
  const env = dependencies.env || process.env;
  if (!operatorTokenConfigured(env)) {
    return res.status(503).json({
      error: 'Decision packet export needs SCRAPER_ADMIN_TOKEN (or PROPERTY_OPERATOR_SECRET) on the API server.',
      requiredConfiguration: 'SCRAPER_ADMIN_TOKEN',
    });
  }

  // Authentication & RBAC Authorization
  const authResolve = dependencies.resolveAuth || resolveRequestAuth;
  const auth = authResolve(req, env);

  if (!auth.authenticated) {
    return res.status(401).json({
      error: 'Authentication required to export underwriting decision packets',
      code: 'AUTH_REQUIRED',
    });
  }

  if (!hasPermission(auth.role, 'canExportDossier')) {
    return res.status(403).json({
      error: 'Forbidden: Insufficient permissions to export underwriting decision packets',
      code: 'PERMISSION_DENIED',
      role: auth.role,
    });
  }

  // Lookup listing
  const database = dependencies.database || db;
  const listing = await database.getListingById(id);
  if (!listing) {
    return res.status(404).json({ error: 'Listing not found', id });
  }

  // Extract operator inputs from query params and optional request body
  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const operatorInput = {};

  const disposition = body.disposition || url.searchParams.get('disposition');
  if (typeof disposition === 'string' && disposition.trim()) {
    operatorInput.disposition = disposition.trim();
  }

  const mao = parseNumber(body.maxAllowableOffer ?? url.searchParams.get('maxAllowableOffer'));
  if (mao !== null) operatorInput.maxAllowableOffer = mao;

  const rehab = parseNumber(body.rehabBudget ?? url.searchParams.get('rehabBudget'));
  if (rehab !== null) operatorInput.rehabBudget = rehab;

  const targetMargin = parseNumber(body.targetMargin ?? url.searchParams.get('targetMargin'));
  if (targetMargin !== null) operatorInput.targetMargin = targetMargin;

  const notes = body.operatorNotes || url.searchParams.get('operatorNotes');
  if (typeof notes === 'string' && notes.trim()) {
    operatorInput.operatorNotes = notes.trim();
  }

  const operatorId = body.operatorId || url.searchParams.get('operatorId');
  if (typeof operatorId === 'string' && operatorId.trim()) {
    operatorInput.operatorId = operatorId.trim();
  }

  for (const field of CASH_OVERRIDE_FIELDS) {
    const val = parseNumber(body[field] ?? url.searchParams.get(field));
    if (val !== null) operatorInput[field] = val;
  }

  // Build decision packet
  const packetBuilder = dependencies.buildDecisionPacket || buildDecisionPacket;
  const packet = packetBuilder(listing, operatorInput);

  // Format negotiation
  const format = String(url.searchParams.get('format') || '').toLowerCase();
  const accept = String(req.headers.accept || '').toLowerCase();
  const isMarkdown = format === 'markdown' || format === 'md' || (accept.includes('text/markdown') && !accept.includes('application/json'));

  if (isMarkdown) {
    const markdownFormatter = dependencies.formatDecisionPacketMarkdown || formatDecisionPacketMarkdown;
    const md = markdownFormatter(packet);
    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="decision-packet-${encodeURIComponent(id)}.md"`);
    if (typeof res.send === 'function') {
      return res.send(md);
    }
    return res.end(md);
  }

  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.json(packet);
}

module.exports = {
  handleDecisionPacket,
  resolveRequestAuth,
};
