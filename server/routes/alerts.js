const crypto = require('node:crypto');
const db = require('../db/client');
const { getCanonicalOrigin } = require('../app-origin');
const { mailIsConfigured, sendOutboundMail } = require('../delivery/outbound-mail');
const { resolveWatchlistIdentity, requireUserIdentity } = require('../security/workspace-identity');
const { generateInvestorDigestReport, dispatchInvestorAlertDigest } = require('../delivery/alert-digest');

const EMAIL_REGEX = /^[^\s@\r\n]+@[^\s@\r\n]+\.[^\s@\r\n]+$/;
const ALLOWED_CADENCES = ['instant', 'daily', 'weekly'];
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const CONFIRM_TOKEN_TTL_MS = 48 * 60 * 60 * 1000;

function isValidEmail(email) {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (/[\r\n]/.test(trimmed)) return false;
  return EMAIL_REGEX.test(trimmed);
}

function isValidState(state) {
  return typeof state === 'string' && /^[A-Za-z]{2}$/.test(state.trim());
}

function isValidCounty(county) {
  return typeof county === 'string' && county.trim().length > 0 && county.trim().length <= 64;
}

function resolveCadence(cadence) {
  if (cadence === undefined || cadence === null || cadence === '') return 'daily';
  if (typeof cadence !== 'string') return null;
  const lower = cadence.trim().toLowerCase();
  return ALLOWED_CADENCES.includes(lower) ? lower : null;
}

function escapeHtml(value) {
  if (value == null) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function countyToSlug(county) {
  return String(county || '')
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function resolveAlertSigningKey(env = process.env) {
  const secret = String(
    env.ALERTS_SIGNING_SECRET
    || env.WORKSPACE_SESSION_SECRET
    || env.SCRAPER_ADMIN_TOKEN
    || env.PROPERTY_OPERATOR_SECRET
    || '',
  ).trim();
  if (!secret) return null;
  return crypto
    .createHash('sha256')
    .update('perfectproperty/county-alert-confirm/v1\0')
    .update(secret)
    .digest();
}

function signCountyConfirmToken({ userId, subscriptionId, email }, options = {}) {
  const env = options.env || process.env;
  const key = resolveAlertSigningKey(env);
  if (!key) return null;
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
  const ttlMs = typeof options.ttlMs === 'number' && Number.isFinite(options.ttlMs) && options.ttlMs > 0
    ? options.ttlMs
    : CONFIRM_TOKEN_TTL_MS;
  const payload = {
    v: 1,
    uid: String(userId || ''),
    sid: String(subscriptionId || ''),
    email: String(email || '').trim().toLowerCase(),
    iat: now,
    exp: now + ttlMs,
  };
  if (!payload.uid || !payload.sid || !payload.email) return null;
  const payloadB64 = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sigB64 = crypto.createHmac('sha256', key).update(payloadB64, 'utf8').digest('base64url');
  return `${payloadB64}.${sigB64}`;
}

function verifyCountyConfirmToken(token, options = {}) {
  const env = options.env || process.env;
  const now = typeof options.now === 'number' && Number.isFinite(options.now) ? options.now : Date.now();
  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, status: 400, error: 'Confirmation token is required' };
  }
  const trimmed = token.trim();
  const parts = trimmed.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1] || !BASE64URL_RE.test(parts[0]) || !BASE64URL_RE.test(parts[1])) {
    return { ok: false, status: 400, error: 'Malformed confirmation token' };
  }
  const [payloadB64, sigB64] = parts;
  const key = resolveAlertSigningKey(env);
  if (!key) {
    return { ok: false, status: 403, error: 'Confirmation signing key is not configured' };
  }
  const expectedSig = crypto.createHmac('sha256', key).update(payloadB64, 'utf8').digest();
  let providedSig;
  try {
    providedSig = Buffer.from(sigB64, 'base64url');
  } catch {
    return { ok: false, status: 400, error: 'Malformed confirmation token signature' };
  }
  if (
    providedSig.length !== expectedSig.length
    || providedSig.toString('base64url') !== sigB64
    || !crypto.timingSafeEqual(providedSig, expectedSig)
  ) {
    return { ok: false, status: 403, error: 'Invalid confirmation token signature' };
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, status: 400, error: 'Invalid confirmation token payload' };
  }

  if (
    !payload
    || payload.v !== 1
    || typeof payload.uid !== 'string' || !payload.uid
    || typeof payload.sid !== 'string' || !payload.sid
    || typeof payload.email !== 'string' || !payload.email
    || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)
  ) {
    return { ok: false, status: 400, error: 'Invalid confirmation token payload' };
  }

  if (now > payload.exp) {
    return { ok: false, status: 400, error: 'Confirmation token has expired' };
  }

  return { ok: true, payload };
}

async function confirmCountyDigest({ token, database = db, env = process.env, now = Date.now() }) {
  const verification = verifyCountyConfirmToken(token, { env, now });
  if (!verification.ok) {
    return { status: verification.status, body: { ok: false, error: verification.error } };
  }

  const { uid, sid, email } = verification.payload;
  const savedSearch = await database.getSavedSearchById(uid, sid);
  if (!savedSearch) {
    return { status: 404, body: { ok: false, error: 'County alert subscription not found' } };
  }

  const storedEmail = String(savedSearch.filters?.notifyEmail || savedSearch.filters?.email || '').trim().toLowerCase();
  if (!storedEmail || storedEmail !== email.trim().toLowerCase()) {
    return { status: 403, body: { ok: false, error: 'Subscription email mismatch' } };
  }

  const state = Array.isArray(savedSearch.filters?.states) ? savedSearch.filters.states[0] || null : null;
  const county = Array.isArray(savedSearch.filters?.counties) ? savedSearch.filters.counties[0] || null : null;

  if (savedSearch.filters?.verified === true) {
    return {
      status: 200,
      body: {
        ok: true,
        success: true,
        verified: true,
        alreadyVerified: true,
        subscriptionId: savedSearch.id,
        label: savedSearch.label,
        state,
        county,
        message: 'County alert subscription is already confirmed',
      },
    };
  }

  const verifiedAt = new Date(now).toISOString();
  const updated = await database.updateSavedSearch(uid, sid, {
    filters: {
      ...(savedSearch.filters || {}),
      verified: true,
      verifiedAt,
    },
  });

  if (!updated) {
    return { status: 404, body: { ok: false, error: 'County alert subscription not found' } };
  }

  return {
    status: 200,
    body: {
      ok: true,
      success: true,
      verified: true,
      subscriptionId: updated.id,
      label: updated.label,
      state,
      county,
      message: `Confirmed alerts for ${updated.label || 'county digest'}`,
    },
  };
}

function createAlertsHandler(dependencies = {}) {
  const database = dependencies.database || db;
  const env = dependencies.env || process.env;
  const sendMailImpl = dependencies.sendOutboundMail || sendOutboundMail;
  const isMailConfiguredImpl = dependencies.mailIsConfigured || mailIsConfigured;

  return async function handleAlerts(req, res) {
    const method = req.method;
    const url = new URL(req.url || '/api/alerts', 'http://localhost');
    res.setHeader('Cache-Control', 'no-store');

    if (method === 'GET' && url.searchParams.get('action') === 'confirm_county_digest') {
      const token = url.searchParams.get('token');
      const result = await confirmCountyDigest({
        token,
        database,
        env,
        now: typeof dependencies.now === 'function' ? dependencies.now() : Date.now(),
      });
      return res.status(result.status).json(result.body);
    }

    if (method === 'POST' && req.body?.action === 'confirm_county_digest') {
      const token = req.body?.token;
      const result = await confirmCountyDigest({
        token,
        database,
        env,
        now: typeof dependencies.now === 'function' ? dependencies.now() : Date.now(),
      });
      return res.status(result.status).json(result.body);
    }

    const userId = resolveWatchlistIdentity(req, res, env);
    if (!userId) return;

    if (method === 'GET') {
      const saved = await database.getSavedDeals(userId);
      if (url.searchParams.get('format') === 'digest') {
        const evaluation = {
          results: saved.map((deal) => ({ identityKey: deal.id, listingId: deal.id, status: 'match' })),
          matches: saved.map((deal) => ({ listingId: deal.id, listing: deal })),
        };
        const digest = generateInvestorDigestReport({
          hunt: { id: `watchlist-${userId.slice(0, 8)}`, name: 'Watchlist Deals' },
          evaluation,
          listings: saved,
        });
        return res.json(digest);
      }
      return res.json({ savedCount: saved.length, deals: saved });
    }

    if (method === 'POST') {
      const { listingId, action, recipientEmail } = req.body || {};
      if (action === 'dispatch_digest') {
        const authenticatedUserId = requireUserIdentity(req, res, env);
        if (!authenticatedUserId) return;
        let recipient = (recipientEmail || req.body?.recipient || req.body?.email || '').trim();
        if (authenticatedUserId.startsWith('account:')) {
          const accountId = authenticatedUserId.slice('account:'.length);
          const member = await require('../accounts/store').accountServiceFor(database).get(accountId).catch(() => null);
          if (!member?.email) return res.status(403).json({ error: 'Member email could not be verified' });
          if (recipient && recipient.toLowerCase() !== String(member.email).toLowerCase()) {
            return res.status(403).json({ error: 'Members can only dispatch digests to their signed-in email address' });
          }
          recipient = member.email;
        }
        const saved = await database.getSavedDeals(authenticatedUserId);
        const evaluation = {
          results: saved.map((deal) => ({ identityKey: deal.id, listingId: deal.id, status: 'match' })),
          matches: saved.map((deal) => ({ listingId: deal.id, listing: deal })),
        };
        const result = await dispatchInvestorAlertDigest({
          recipient,
          hunt: { id: `watchlist-${userId.slice(0, 8)}`, name: 'Watchlist Deals', notifyEmail: recipient },
          evaluation,
          listings: saved,
          options: { env },
        });
        return res.json(result);
      }
      if (action === 'subscribe_county_digest') {
        const { email, state, county, cadence } = req.body || {};
        if (!isValidEmail(email)) {
          return res.status(400).json({ error: 'Valid email is required' });
        }
        if (!isValidState(state)) {
          return res.status(400).json({ error: 'Valid 2-letter state code is required' });
        }
        if (!isValidCounty(county)) {
          return res.status(400).json({ error: 'Valid county is required' });
        }
        const resolvedCadence = resolveCadence(cadence);
        if (!resolvedCadence) {
          return res.status(400).json({ error: 'Invalid cadence; must be instant, daily, or weekly' });
        }

        const cleanEmail = email.trim().toLowerCase();
        const cleanState = state.trim().toUpperCase();
        const cleanCounty = county.trim().toLowerCase();

        let isVerifiedSession = false;
        if (userId.startsWith('account:')) {
          const accountId = userId.slice('account:'.length);
          const member = await require('../accounts/store').accountServiceFor(database).get(accountId).catch(() => null);
          const memberEmail = member?.email ? String(member.email).trim().toLowerCase() : null;
          isVerifiedSession = Boolean(memberEmail && memberEmail === cleanEmail);
        } else if (userId.startsWith('workspace:')) {
          const operatorEmail = String(env.OPERATOR_EMAIL || '').trim().toLowerCase();
          isVerifiedSession = operatorEmail ? cleanEmail === operatorEmail : true;
        }

        if (!isVerifiedSession && typeof database.getSavedSearches === 'function') {
          const existingSearches = await database.getSavedSearches(userId);
          if (Array.isArray(existingSearches) && existingSearches.length >= 10) {
            return res.status(429).json({ error: 'Maximum 10 county alert subscriptions reached for this session' });
          }
        } else if (!isVerifiedSession && typeof database.listSavedSearches === 'function') {
          const existingSearches = await database.listSavedSearches(userId, { includeInactive: true });
          if (Array.isArray(existingSearches) && existingSearches.length >= 10) {
            return res.status(429).json({ error: 'Maximum 10 county alert subscriptions reached for this session' });
          }
        }

        const nowMs = typeof dependencies.now === 'function' ? dependencies.now() : Date.now();
        const nowIso = new Date(nowMs).toISOString();

        const search = await database.createSavedSearch(userId, {
          label: `${county.trim()}, ${cleanState} Digest`,
          filters: {
            states: [cleanState],
            counties: [cleanCounty],
            notifyEmail: cleanEmail,
            email: cleanEmail,
            cadence: resolvedCadence,
            verified: isVerifiedSession,
            ...(isVerifiedSession
              ? { verifiedAt: nowIso }
              : { verificationRequestedAt: nowIso }),
          },
        });

        if (isVerifiedSession) {
          return res.json({
            ok: true,
            success: true,
            pendingConfirmation: false,
            verified: true,
            subscriptionId: search.id,
            message: `Subscribed to ${county}, ${state} alerts`,
          });
        }

        const token = signCountyConfirmToken(
          { userId, subscriptionId: search.id, email: cleanEmail },
          { env, now: nowMs },
        );
        let mailDelivery = 'not-configured';
        if (token && (isMailConfiguredImpl(env) || env.PROPERTY_MAIL_OUTBOX_DIR)) {
          const appUrl = getCanonicalOrigin(null, env);
          const countySlug = countyToSlug(cleanCounty);
          const confirmUrl = `${appUrl}/states/${cleanState}/${countySlug}?confirm_alert=${encodeURIComponent(token)}`;
          const countyLabel = county.trim();
          const mailResult = await sendMailImpl({
            to: cleanEmail,
            kind: 'county-alert-confirm',
            subject: `Confirm your ${countyLabel}, ${cleanState} sale alerts`,
            text: [
              `Confirm your PerfectProperty alert subscription for ${countyLabel}, ${cleanState} (${resolvedCadence} digest).`,
              '',
              `Confirm subscription: ${confirmUrl}`,
              '',
              'This link expires in 48 hours. If you did not request these alerts, you can ignore this email and no digests will be sent.',
            ].join('\n'),
            html: [
              `<p>Confirm your PerfectProperty alert subscription for <strong>${escapeHtml(countyLabel)}, ${escapeHtml(cleanState)}</strong> (${escapeHtml(resolvedCadence)} digest).</p>`,
              `<p><a href="${escapeHtml(confirmUrl)}">Confirm alert subscription</a></p>`,
              '<p>This link expires in 48 hours. If you did not request these alerts, you can ignore this email and no digests will be sent.</p>',
            ].join(''),
          }, { env, ...(dependencies.mailOptions || {}) });
          mailDelivery = mailResult?.delivery || 'unavailable';
        }

        return res.json({
          ok: true,
          success: true,
          pendingConfirmation: true,
          verified: false,
          subscriptionId: search.id,
          mailDelivery,
          message: `Confirmation required for ${cleanEmail} to activate ${county.trim()}, ${cleanState} alerts`,
        });
      }
      if (action === 'set_stage') {
        const stage = typeof req.body?.stage === 'string' ? req.body.stage.trim() : '';
        if (typeof listingId !== 'string' || !listingId || listingId.length > 256) {
          return res.status(400).json({ error: 'listingId is required' });
        }
        if (!require('../db/workspace-persistence').VALID_PIPELINE_STAGES.has(stage)) {
          return res.status(400).json({ error: 'Invalid pipeline stage' });
        }
        const updated = await database.updateSavedDealStage(userId, listingId, stage);
        if (!updated) return res.status(404).json({ error: 'Saved deal not found' });
        return res.json({ ok: true, listingId, pipelineStage: updated.pipelineStage });
      }
      if (typeof listingId !== 'string' || !listingId || listingId.length > 256) return res.status(400).json({ error: 'listingId is required' });
      if (!await database.getListingById(listingId)) return res.status(404).json({ error: 'Listing not found' });
      await database.saveDeal(userId, listingId);
      return res.status(201).json({ success: true, message: 'Deal saved to watchlist' });
    }

    if (method === 'PATCH') {
      const { listingId, stage } = req.body || {};
      const cleanStage = typeof stage === 'string' ? stage.trim() : '';
      if (typeof listingId !== 'string' || !listingId || listingId.length > 256) {
        return res.status(400).json({ error: 'listingId is required' });
      }
      if (!require('../db/workspace-persistence').VALID_PIPELINE_STAGES.has(cleanStage)) {
        return res.status(400).json({ error: 'Invalid pipeline stage' });
      }
      const updated = await database.updateSavedDealStage(userId, listingId, cleanStage);
      if (!updated) return res.status(404).json({ error: 'Saved deal not found' });
      return res.json({ ok: true, listingId, pipelineStage: updated.pipelineStage });
    }

    if (method === 'DELETE') {
      const listingId = (req.body && typeof req.body.listingId === 'string' && req.body.listingId) || url.searchParams.get('listingId');
      if (typeof listingId !== 'string' || !listingId || listingId.length > 256) return res.status(400).json({ error: 'listingId is required' });
      await database.removeSavedDeal(userId, listingId);
      return res.json({ success: true, message: 'Deal removed from watchlist' });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  };
}

const handleAlerts = createAlertsHandler();
handleAlerts.createAlertsHandler = createAlertsHandler;
handleAlerts.signCountyConfirmToken = signCountyConfirmToken;
handleAlerts.verifyCountyConfirmToken = verifyCountyConfirmToken;
handleAlerts.confirmCountyDigest = confirmCountyDigest;

module.exports = handleAlerts;
