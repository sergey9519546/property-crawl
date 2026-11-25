'use strict';

const { computeCashiersCheckLadder } = require('../intelligence/check-ladder');

const MAX_BODY_BYTES = 512 * 1024;
const MAX_TARGETS = 50;
const MAX_DENOMINATIONS = 10;

function readJsonBody(req) {
  if (req && req.body !== undefined) {
    if (typeof req.body === 'string') {
      if (!req.body.trim()) return Promise.resolve({ ok: true, body: {} });
      try {
        const parsed = JSON.parse(req.body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return Promise.resolve({ ok: false, status: 400, error: 'JSON request body must be an object' });
        }
        return Promise.resolve({ ok: true, body: parsed });
      } catch {
        return Promise.resolve({ ok: false, status: 400, error: 'Invalid JSON request body' });
      }
    }
    if (Buffer.isBuffer(req.body)) {
      const text = req.body.toString('utf8');
      if (!text.trim()) return Promise.resolve({ ok: true, body: {} });
      try {
        const parsed = JSON.parse(text);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          return Promise.resolve({ ok: false, status: 400, error: 'JSON request body must be an object' });
        }
        return Promise.resolve({ ok: true, body: parsed });
      } catch {
        return Promise.resolve({ ok: false, status: 400, error: 'Invalid JSON request body' });
      }
    }
    if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
      return Promise.resolve({ ok: true, body: req.body });
    }
    return Promise.resolve({ ok: false, status: 400, error: 'JSON request body must be an object' });
  }

  if (!req || typeof req.on !== 'function') {
    return Promise.resolve({ ok: true, body: {} });
  }

  return new Promise((resolve) => {
    const chunks = [];
    let totalBytes = 0;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    req.on('data', (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      totalBytes += buf.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        finish({ ok: false, status: 413, error: 'Request body too large' });
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw.trim()) {
        finish({ ok: true, body: {} });
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          finish({ ok: false, status: 400, error: 'JSON request body must be an object' });
          return;
        }
        finish({ ok: true, body: parsed });
      } catch {
        finish({ ok: false, status: 400, error: 'Invalid JSON request body' });
      }
    });
    req.on('error', () => {
      finish({ ok: false, status: 400, error: 'Failed to read request body' });
    });
  });
}

function sendOptionsOk(res) {
  if (typeof res.setHeader === 'function') {
    res.setHeader('Allow', 'POST, OPTIONS');
  }
  if (typeof res.status === 'function') res.status(204);
  if (typeof res.send === 'function') return res.send('');
  if (typeof res.end === 'function') return res.end();
  if (typeof res.json === 'function') return res.json({ ok: true });
  return undefined;
}

function parseOptionalAvailableCapital(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, value: null };
  }
  if (typeof raw === 'string' && !raw.trim()) {
    return { ok: true, value: null };
  }
  if (typeof raw === 'boolean' || (typeof raw !== 'number' && typeof raw !== 'string')) {
    return { ok: false, error: 'availableCapital must be a finite non-negative number' };
  }
  const num = typeof raw === 'number'
    ? raw
    : Number(raw.replace(/[$,\s]/g, ''));
  if (!Number.isFinite(num) || num < 0) {
    return { ok: false, error: 'availableCapital must be a finite non-negative number' };
  }
  return { ok: true, value: num };
}

function parseOptionalDenominations(raw) {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_DENOMINATIONS) {
    return {
      ok: false,
      error: `denominations must be a non-empty array of at most ${MAX_DENOMINATIONS} finite positive integers`,
    };
  }
  const parsed = [];
  for (const item of raw) {
    if (typeof item !== 'number' || !Number.isFinite(item) || !Number.isInteger(item) || item <= 0) {
      return {
        ok: false,
        error: `denominations must be a non-empty array of at most ${MAX_DENOMINATIONS} finite positive integers`,
      };
    }
    parsed.push(item);
  }
  return { ok: true, value: parsed };
}

function createCheckLadderHandler(deps = {}) {
  const ladderComputer = deps.computeCashiersCheckLadder || computeCashiersCheckLadder;
  const nowFn = typeof deps.now === 'function' ? deps.now : () => new Date();

  return async function handleCheckLadder(req, res) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Cache-Control', 'no-store');
    }

    const method = String(req?.method || '').toUpperCase();
    if (method === 'OPTIONS') {
      return sendOptionsOk(res);
    }
    if (method !== 'POST') {
      if (typeof res.setHeader === 'function') {
        res.setHeader('Allow', 'POST, OPTIONS');
      }
      return res.status(405).json({ error: 'Method not allowed. Use POST /api/check-ladder.' });
    }

    const parsedBody = await readJsonBody(req);
    if (!parsedBody.ok) {
      return res.status(parsedBody.status || 400).json({ error: parsedBody.error });
    }
    const body = parsedBody.body;

    if (!Array.isArray(body?.targets) || body.targets.length < 1 || body.targets.length > MAX_TARGETS) {
      return res.status(400).json({
        error: `targets is required and must be an array of 1 to ${MAX_TARGETS} target entries`,
      });
    }

    const capitalCheck = parseOptionalAvailableCapital(body.availableCapital);
    if (!capitalCheck.ok) {
      return res.status(400).json({ error: capitalCheck.error });
    }

    const denomCheck = parseOptionalDenominations(body.denominations);
    if (!denomCheck.ok) {
      return res.status(400).json({ error: denomCheck.error });
    }

    const plan = ladderComputer({
      targets: body.targets,
      availableCapital: capitalCheck.value,
      ...(denomCheck.value !== undefined ? { denominations: denomCheck.value } : {}),
    });

    return res.status(200).json({
      schema: 'perfectproperty.check-ladder.v1',
      generatedAt: nowFn().toISOString(),
      ...plan,
    });
  };
}

module.exports = createCheckLadderHandler;
module.exports.createCheckLadderHandler = createCheckLadderHandler;
