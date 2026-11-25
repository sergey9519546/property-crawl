// Stateful SQLite-backed Durable Object agents for Cloudflare Workers Free tier ($0/mo).
// Zero runtime npm dependencies so worker.js remains directly testable in Node.js (`node --test`).

const DEFAULT_API_ORIGIN = 'https://property-crawl-api.vercel.app';
const MAX_RUN_HISTORY = 200;

export function retryDelayMs(attemptNumber) {
  const step = Math.max(1, Number(attemptNumber) || 1);
  return Math.min(30_000 * Math.pow(4, step - 1), 15 * 60_000);
}

export function emailRetryDelayMs(attemptNumber) {
  const schedule = [60_000, 180_000, 600_000, 1_800_000];
  const idx = Math.max(0, Math.min(schedule.length - 1, (Number(attemptNumber) || 1) - 1));
  return schedule[idx];
}

export function isAutoReplyHeaders(headers) {
  if (!headers) return false;
  const readHeader = (name) => {
    if (typeof headers.get === 'function') return headers.get(name) || '';
    const lower = name.toLowerCase();
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === lower) return String(v || '');
    }
    return '';
  };

  const autoSubmitted = readHeader('auto-submitted').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return true;
  if (readHeader('x-auto-response-suppress').trim()) return true;
  const precedence = readHeader('precedence').trim().toLowerCase();
  if (precedence === 'auto_reply' || precedence === 'bulk' || precedence === 'junk') return true;
  return false;
}

export async function timingSafeTokenMatch(presented, expected) {
  const left = String(presented || '').trim();
  const right = String(expected || '').trim();
  if (!left || !right) return false;
  const encoder = new TextEncoder();
  const subtle = globalThis.crypto?.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    const [aHash, bHash] = await Promise.all([
      subtle.digest('SHA-256', encoder.encode(left)),
      subtle.digest('SHA-256', encoder.encode(right)),
    ]);
    const a = new Uint8Array(aHash);
    const b = new Uint8Array(bHash);
    let diff = 0;
    for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
    return diff === 0;
  }
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return diff === 0;
}

export async function notifyOperatorFailure(env, action, details) {
  try {
    if (env?.ALERT_WEBHOOK_URL) {
      await fetch(env.ALERT_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'edge_cron_failure', action, ...details }),
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
      }).catch(() => {});
    } else if (env?.RESEND_API_KEY && env?.OPERATOR_EMAIL) {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: env.RESEND_FROM || 'alerts@perfectproperty.bid',
          to: [env.OPERATOR_EMAIL],
          subject: `[PropertyCrawl Edge Alert] ${action} failed`,
          text: JSON.stringify(details, null, 2),
        }),
        signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(8_000) : undefined,
      }).catch(() => {});
    }
  } catch {
    // Notification failures must not crash agent alarms or responses.
  }
}

function isRetryableFailure(status, threw) {
  if (threw) return true;
  if (!Number.isFinite(status)) return true;
  return status >= 500 || status === 429 || status === 408;
}

function agentJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

async function callUpstreamScraperRun(env, payload, tokenHeader = 'Authorization') {
  const token = String(env?.SCRAPER_ADMIN_TOKEN || env?.PROPERTY_OPERATOR_SECRET || '').trim();
  if (!token) {
    return { ok: false, status: 503, retryable: false, error: 'missing_scraper_admin_token', body: '' };
  }
  const apiOrigin = String(env?.API_ORIGIN || env?.ORIGIN_URL || DEFAULT_API_ORIGIN).replace(/\/+$/, '');
  const edgeSecret = String(env?.EDGE_SHARED_SECRET || '').trim();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(edgeSecret ? { 'x-edge-secret': edgeSecret } : {}),
  };
  if (tokenHeader === 'X-Scraper-Admin-Token') {
    headers['X-Scraper-Admin-Token'] = token;
  } else {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const res = await fetch(`${apiOrigin}/api/scrapers/run`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(55_000) : undefined,
    });
    const text = await res.text().catch(() => '');
    if (res.ok) {
      let parsed = null;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {}
      const sourceResults = Array.isArray(parsed?.result?.sourceResults) ? parsed.result.sourceResults : [];
      const failedSources = sourceResults.filter((sr) => sr && typeof sr.error === 'string' && sr.error.trim());
      if ((parsed && typeof parsed.error === 'string' && parsed.error.trim()) || failedSources.length > 0) {
        const firstFail = failedSources[0] || null;
        const errMsg = firstFail ? `${firstFail.sourceId || 'source'}: ${firstFail.error}` : String(parsed.error);
        const nonRetryable = /captcha|challenge|cloudflare|turnstile|403|blocked/i.test(errMsg);
        return {
          ok: false,
          status: res.status,
          retryable: !nonRetryable,
          failedSourceId: firstFail?.sourceId || null,
          error: errMsg.slice(0, 300),
          body: text.slice(0, 500),
        };
      }
    }
    return {
      ok: res.ok,
      status: res.status,
      retryable: !res.ok && isRetryableFailure(res.status, false),
      error: res.ok ? null : `HTTP ${res.status}`,
      body: text.slice(0, 500),
    };
  } catch (err) {
    return {
      ok: false,
      status: 504,
      retryable: true,
      error: err instanceof Error ? err.message : String(err),
      body: '',
    };
  }
}

export class OperationsAgent {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this._schemaReady = false;
  }

  get sql() {
    return this.ctx?.storage?.sql;
  }

  ensureSchema() {
    if (this._schemaReady || !this.sql) return;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS op_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        status INTEGER,
        ok INTEGER NOT NULL,
        attempt INTEGER NOT NULL,
        error TEXT,
        body_excerpt TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS op_retry_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 1,
        max_attempts INTEGER NOT NULL DEFAULT 3,
        next_run_at INTEGER NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
    `);
    this._schemaReady = true;
  }

  recordRun({ action, status, ok, attempt, error = null, body = '' }) {
    this.ensureSchema();
    const nowIso = new Date().toISOString();
    this.sql.exec(
      `INSERT INTO op_runs (action, status, ok, attempt, error, body_excerpt, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      String(action || 'unknown'),
      Number.isFinite(status) ? status : null,
      ok ? 1 : 0,
      Number(attempt) || 1,
      error ? String(error).slice(0, 300) : null,
      String(body || '').slice(0, 300),
      nowIso,
    );
    this.sql.exec(
      `DELETE FROM op_runs WHERE id NOT IN (SELECT id FROM op_runs ORDER BY id DESC LIMIT ?)`,
      MAX_RUN_HISTORY,
    );
  }

  async scheduleNextAlarm() {
    if (!this.sql || typeof this.ctx?.storage?.setAlarm !== 'function') return;
    const rows = this.sql.exec(`SELECT MIN(next_run_at) AS next_at FROM op_retry_queue`).toArray();
    const nextAt = Number(rows?.[0]?.next_at);
    if (Number.isFinite(nextAt) && nextAt > 0) {
      await this.ctx.storage.setAlarm(nextAt);
    }
  }

  async fetch(request) {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/status') {
      const recentRuns = this.sql.exec(
        `SELECT id, action, status, ok, attempt, error, body_excerpt, created_at
         FROM op_runs ORDER BY id DESC LIMIT 20`,
      ).toArray();
      const pendingRetries = this.sql.exec(
        `SELECT id, action, attempts, max_attempts, next_run_at, last_error, created_at
         FROM op_retry_queue ORDER BY next_run_at ASC LIMIT 20`,
      ).toArray();
      return agentJson({
        schema: 'property-crawl.operations-agent/v1',
        pendingCount: pendingRetries.length,
        pendingRetries,
        recentRuns,
      });
    }

    if (request.method === 'POST' && url.pathname === '/dispatch') {
      let body;
      try {
        body = await request.json();
      } catch {
        return agentJson({ ok: false, error: 'Invalid JSON payload' }, 400);
      }
      const action = String(body?.action || '').trim();
      const payload = body?.payload && typeof body.payload === 'object' ? body.payload : { action };
      if (!action) {
        return agentJson({ ok: false, error: 'Missing action' }, 400);
      }

      const result = await callUpstreamScraperRun(this.env, payload, 'Authorization');
      this.recordRun({ action, status: result.status, ok: result.ok, attempt: 1, error: result.error, body: result.body });

      if (result.ok) {
        return agentJson({ ok: true, action, status: result.status, attempt: 1, body: result.body }, 200);
      }

      if (result.retryable) {
        const retryPayload = (action === 'next-slice' && result.failedSourceId)
          ? { action: 'run-source', source: result.failedSourceId, slice: true }
          : payload;
        const nextRunAt = Date.now() + retryDelayMs(1);
        this.sql.exec(
          `INSERT INTO op_retry_queue (action, payload_json, attempts, max_attempts, next_run_at, last_error, created_at)
           VALUES (?, ?, 1, 3, ?, ?, ?)`,
          action,
          JSON.stringify(retryPayload),
          nextRunAt,
          String(result.error || result.status).slice(0, 300),
          new Date().toISOString(),
        );
        await this.scheduleNextAlarm();
        return agentJson({ ok: false, queuedForRetry: true, action, status: result.status, nextRunAt }, 202);
      }

      await notifyOperatorFailure(this.env, action, { status: result.status, error: result.error, body: result.body });
      return agentJson({ ok: false, queuedForRetry: false, action, status: result.status, error: result.error }, 502);
    }

    return agentJson({ error: 'Not found' }, 404);
  }

  async alarm() {
    this.ensureSchema();
    const now = Date.now();
    const due = this.sql.exec(
      `SELECT id, action, payload_json, attempts, max_attempts
       FROM op_retry_queue
       WHERE next_run_at <= ?
       ORDER BY next_run_at ASC
       LIMIT 5`,
      now,
    ).toArray();

    for (const item of due) {
      let payload;
      try {
        payload = JSON.parse(item.payload_json);
      } catch {
        payload = { action: item.action };
      }
      const nextAttempt = Number(item.attempts || 1) + 1;
      const result = await callUpstreamScraperRun(this.env, payload, 'Authorization');
      this.recordRun({
        action: item.action,
        status: result.status,
        ok: result.ok,
        attempt: nextAttempt,
        error: result.error,
        body: result.body,
      });

      if (result.ok) {
        this.sql.exec(`DELETE FROM op_retry_queue WHERE id = ?`, item.id);
        continue;
      }

      if (!result.retryable || nextAttempt >= Number(item.max_attempts || 3)) {
        this.sql.exec(`DELETE FROM op_retry_queue WHERE id = ?`, item.id);
        await notifyOperatorFailure(this.env, item.action, {
          status: result.status,
          attempt: nextAttempt,
          exhausted: true,
          error: result.error,
          body: result.body,
        });
      } else {
        const nextRunAt = Date.now() + retryDelayMs(nextAttempt);
        this.sql.exec(
          `UPDATE op_retry_queue SET attempts = ?, next_run_at = ?, last_error = ? WHERE id = ?`,
          nextAttempt,
          nextRunAt,
          String(result.error || result.status).slice(0, 300),
          item.id,
        );
      }
    }

    await this.scheduleNextAlarm();
  }
}

export class EmailNoticeAgent {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this._schemaReady = false;
  }

  get sql() {
    return this.ctx?.storage?.sql;
  }

  ensureSchema() {
    if (this._schemaReady || !this.sql) return;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS email_queue (
        id TEXT PRIMARY KEY,
        r2_key TEXT,
        from_addr TEXT,
        to_addr TEXT,
        subject TEXT,
        raw_mime TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 5,
        next_run_at INTEGER NOT NULL,
        last_error TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS email_dlq (
        id TEXT PRIMARY KEY,
        r2_key TEXT,
        from_addr TEXT,
        to_addr TEXT,
        subject TEXT,
        attempts INTEGER NOT NULL,
        last_error TEXT,
        failed_at TEXT NOT NULL
      );
    `);
    this._schemaReady = true;
  }

  async scheduleNextAlarm() {
    if (!this.sql || typeof this.ctx?.storage?.setAlarm !== 'function') return;
    const rows = this.sql.exec(`SELECT MIN(next_run_at) AS next_at FROM email_queue WHERE attempts > 0`).toArray();
    const nextAt = Number(rows?.[0]?.next_at);
    if (Number.isFinite(nextAt) && nextAt > 0) {
      await this.ctx.storage.setAlarm(nextAt);
    }
  }

  async fetch(request) {
    this.ensureSchema();
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/status') {
      const pending = this.sql.exec(
        `SELECT id, r2_key, from_addr, to_addr, subject, attempts, max_attempts, next_run_at, last_error, created_at
         FROM email_queue ORDER BY created_at DESC LIMIT 25`,
      ).toArray();
      const dlq = this.sql.exec(
        `SELECT id, r2_key, from_addr, to_addr, subject, attempts, last_error, failed_at
         FROM email_dlq ORDER BY failed_at DESC LIMIT 25`,
      ).toArray();
      return agentJson({
        schema: 'property-crawl.email-notice-agent/v1',
        pendingCount: pending.length,
        dlqCount: dlq.length,
        pending,
        dlq,
      });
    }

    if (request.method === 'POST' && url.pathname === '/enqueue') {
      let body;
      try {
        body = await request.json();
      } catch {
        return agentJson({ ok: false, error: 'Invalid JSON payload' }, 400);
      }

      const id = String(body?.id || `eml_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`);
      if (isAutoReplyHeaders(body?.headers)) {
        return agentJson({ ok: true, id, skipped: 'auto_reply' }, 200);
      }

      const r2Key = body?.r2Key ? String(body.r2Key) : null;
      const from = String(body?.from || '');
      const to = String(body?.to || '');
      const subject = String(body?.subject || '');
      const raw = String(body?.raw || '');
      const nowIso = new Date().toISOString();

      // Persist before attempting upstream delivery so an upstream timeout never drops a statutory notice.
      this.sql.exec(
        `INSERT OR REPLACE INTO email_queue
          (id, r2_key, from_addr, to_addr, subject, raw_mime, attempts, max_attempts, next_run_at, last_error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, 5, ?, NULL, ?)`,
        id,
        r2Key,
        from,
        to,
        subject,
        r2Key ? '' : raw,
        Date.now(),
        nowIso,
      );

      const result = await callUpstreamScraperRun(
        this.env,
        { action: 'email-ingest', raw, from, to, subject },
        'X-Scraper-Admin-Token',
      );

      if (result.ok) {
        this.sql.exec(`DELETE FROM email_queue WHERE id = ?`, id);
        return agentJson({ ok: true, id, r2Key, delivered: true, status: result.status }, 200);
      }

      if (result.retryable) {
        const nextRunAt = Date.now() + emailRetryDelayMs(1);
        this.sql.exec(
          `UPDATE email_queue SET attempts = 1, next_run_at = ?, last_error = ?, raw_mime = ? WHERE id = ?`,
          nextRunAt,
          String(result.error || result.status).slice(0, 300),
          raw,
          id,
        );
        await this.scheduleNextAlarm();
        return agentJson({ ok: false, queuedForRetry: true, id, r2Key, status: result.status, nextRunAt }, 202);
      }

      this.sql.exec(
        `INSERT OR REPLACE INTO email_dlq (id, r2_key, from_addr, to_addr, subject, attempts, last_error, failed_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        id,
        r2Key,
        from,
        to,
        subject,
        String(result.error || result.status).slice(0, 300),
        nowIso,
      );
      this.sql.exec(`DELETE FROM email_queue WHERE id = ?`, id);
      await notifyOperatorFailure(this.env, 'email-ingest', { id, r2Key, status: result.status, error: result.error });
      return agentJson({ ok: false, queuedForRetry: false, dlq: true, id, r2Key, status: result.status }, 502);
    }

    return agentJson({ error: 'Not found' }, 404);
  }

  async alarm() {
    this.ensureSchema();
    const now = Date.now();
    const due = this.sql.exec(
      `SELECT id, r2_key, from_addr, to_addr, subject, raw_mime, attempts, max_attempts
       FROM email_queue
       WHERE attempts > 0 AND next_run_at <= ?
       ORDER BY next_run_at ASC
       LIMIT 5`,
      now,
    ).toArray();

    for (const item of due) {
      let raw = item.raw_mime || '';
      if (!raw && item.r2_key && this.env?.VAULT && typeof this.env.VAULT.get === 'function') {
        try {
          const obj = await this.env.VAULT.get(item.r2_key);
          if (obj && typeof obj.text === 'function') raw = await obj.text();
        } catch {
          raw = '';
        }
      }

      const nextAttempt = Number(item.attempts || 0) + 1;
      const result = await callUpstreamScraperRun(
        this.env,
        { action: 'email-ingest', raw, from: item.from_addr || '', to: item.to_addr || '', subject: item.subject || '' },
        'X-Scraper-Admin-Token',
      );

      if (result.ok) {
        this.sql.exec(`DELETE FROM email_queue WHERE id = ?`, item.id);
        continue;
      }

      if (!result.retryable || nextAttempt >= Number(item.max_attempts || 5)) {
        this.sql.exec(
          `INSERT OR REPLACE INTO email_dlq (id, r2_key, from_addr, to_addr, subject, attempts, last_error, failed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          item.id,
          item.r2_key || null,
          item.from_addr || '',
          item.to_addr || '',
          item.subject || '',
          nextAttempt,
          String(result.error || result.status).slice(0, 300),
          new Date().toISOString(),
        );
        this.sql.exec(`DELETE FROM email_queue WHERE id = ?`, item.id);
        await notifyOperatorFailure(this.env, 'email-ingest', {
          id: item.id,
          r2Key: item.r2_key || null,
          attempt: nextAttempt,
          exhausted: true,
          status: result.status,
          error: result.error,
        });
      } else {
        const nextRunAt = Date.now() + emailRetryDelayMs(nextAttempt);
        this.sql.exec(
          `UPDATE email_queue SET attempts = ?, next_run_at = ?, last_error = ? WHERE id = ?`,
          nextAttempt,
          nextRunAt,
          String(result.error || result.status).slice(0, 300),
          item.id,
        );
      }
    }

    await this.scheduleNextAlarm();
  }
}
