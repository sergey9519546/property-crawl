'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const serverSentry = require('../server/telemetry/sentry');

const ROOT = path.resolve(__dirname, '..');

async function loadTsSentry() {
  return import('../src/lib/telemetry/sentry.ts');
}

test('parseSentryDsn accepts valid HTTPS DSNs with or without path prefix and rejects invalid inputs', async () => {
  const tsSentry = await loadTsSentry();

  for (const mod of [serverSentry, tsSentry]) {
    const standard = mod.parseSentryDsn('https://abc123def456@o42.ingest.us.sentry.io/998877');
    assert.deepEqual(standard, {
      dsn: 'https://abc123def456@o42.ingest.us.sentry.io/998877',
      publicKey: 'abc123def456',
      host: 'o42.ingest.us.sentry.io',
      pathPrefix: '',
      projectId: '998877',
      envelopeUrl: 'https://o42.ingest.us.sentry.io/api/998877/envelope/',
    });

    const prefixed = mod.parseSentryDsn('https://pub999:legacySecret@sentry.internal:8443/ops/sentry/42?ignored=1');
    assert.deepEqual(prefixed, {
      dsn: 'https://pub999@sentry.internal:8443/ops/sentry/42',
      publicKey: 'pub999',
      host: 'sentry.internal:8443',
      pathPrefix: '/ops/sentry',
      projectId: '42',
      envelopeUrl: 'https://sentry.internal:8443/ops/sentry/api/42/envelope/',
    });

    // Negative controls
    assert.equal(mod.parseSentryDsn(''), null);
    assert.equal(mod.parseSentryDsn(null), null);
    assert.equal(mod.parseSentryDsn(undefined), null);
    assert.equal(mod.parseSentryDsn('not-a-url'), null);
    assert.equal(mod.parseSentryDsn('http://abc123@sentry.io/42'), null);
    assert.equal(mod.parseSentryDsn('https://sentry.io/42'), null);
    assert.equal(mod.parseSentryDsn('https://abc123@sentry.io/'), null);
  }
});

test('scrubSensitiveData strips headers, tokens, passwords, emails, and URL query secrets while preserving safe context', async () => {
  const tsSentry = await loadTsSentry();

  const circular = { safeLabel: 'keep-me' };
  circular.self = circular;

  const dirty = {
    headers: {
      authorization: 'Bearer super-secret-jwt-token',
      cookie: 'workspace_session=secretCookie123',
      'set-cookie': 'workspace_session=secretCookie123; HttpOnly',
      'x-edge-secret': 'edge-secret-val',
      'x-scraper-admin-token': 'admin-token-val',
      'x-api-key': 'api-key-val',
      'content-type': 'application/json',
    },
    password: 'my-secret-password',
    accessToken: 'tok_123456',
    userEmail: 'investor@example.com',
    message:
      'Fetch https://maps.googleapis.com/maps/api/streetview?size=600x400&key=AIzaSySecretKey123456789012345&token=abc123 failed for operator@perfectproperty.bid using postgres://pguser:pgpass@db.internal:5432/prod',
    safeCount: 7,
    listingId: 'HUD-12345',
    circular,
  };

  for (const mod of [serverSentry, tsSentry]) {
    const cleaned = mod.scrubSensitiveData(dirty);
    assert.equal(cleaned.headers.authorization, '[Filtered]');
    assert.equal(cleaned.headers.cookie, '[Filtered]');
    assert.equal(cleaned.headers['set-cookie'], '[Filtered]');
    assert.equal(cleaned.headers['x-edge-secret'], '[Filtered]');
    assert.equal(cleaned.headers['x-scraper-admin-token'], '[Filtered]');
    assert.equal(cleaned.headers['x-api-key'], '[Filtered]');
    assert.equal(cleaned.headers['content-type'], 'application/json');
    assert.equal(cleaned.password, '[Filtered]');
    assert.equal(cleaned.accessToken, '[Filtered]');
    assert.equal(cleaned.userEmail, '[Filtered]');
    assert.equal(cleaned.safeCount, 7);
    assert.equal(cleaned.listingId, 'HUD-12345');
    assert.equal(cleaned.circular.safeLabel, 'keep-me');
    assert.equal(cleaned.circular.self, '[Circular]');

    assert.doesNotMatch(cleaned.message, /AIzaSySecretKey/);
    assert.doesNotMatch(cleaned.message, /token=abc123/);
    assert.doesNotMatch(cleaned.message, /operator@perfectproperty\.bid/);
    assert.doesNotMatch(cleaned.message, /pgpass/);
    assert.match(cleaned.message, /key=\[Filtered\]/);
    assert.match(cleaned.message, /token=\[Filtered\]/);
    assert.match(cleaned.message, /postgres:\/\/\[Filtered\]@db\.internal:5432\/prod/);
  }
});

test('captureException is a strict no-op when DSN is unset or invalid', async () => {
  const tsSentry = await loadTsSentry();
  const prevServerDsn = process.env.SENTRY_DSN;
  const prevPublicDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

  try {
    delete process.env.SENTRY_DSN;
    delete process.env.NEXT_PUBLIC_SENTRY_DSN;

    for (const mod of [serverSentry, tsSentry]) {
      let fetchCalls = 0;
      const injectedFetch = async () => {
        fetchCalls += 1;
        return { ok: true, status: 200 };
      };

      const unsetResult = await mod.captureException(new Error('boom'), { fetch: injectedFetch });
      assert.equal(unsetResult.sent, false);
      assert.equal(unsetResult.eventId, null);
      assert.equal(fetchCalls, 0);

      const invalidResult = await mod.captureException(new Error('boom'), {
        dsn: 'http://insecure@sentry.io/123',
        fetch: injectedFetch,
      });
      assert.equal(invalidResult.sent, false);
      assert.equal(invalidResult.eventId, null);
      assert.equal(fetchCalls, 0);
    }
  } finally {
    if (prevServerDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = prevServerDsn;
    if (prevPublicDsn === undefined) delete process.env.NEXT_PUBLIC_SENTRY_DSN;
    else process.env.NEXT_PUBLIC_SENTRY_DSN = prevPublicDsn;
  }
});

test('buildSentryEnvelope and captureException emit valid Sentry Envelope POST payloads and scrub secrets', async () => {
  const tsSentry = await loadTsSentry();
  const dsn = 'https://pubKey123@o111.ingest.sentry.io/222333';

  for (const mod of [serverSentry, tsSentry]) {
    const captured = [];
    const injectedFetch = async (url, init) => {
      captured.push({ url, init });
      return { ok: true, status: 200 };
    };

    const err = new TypeError(
      'Request failed for alice@example.com at https://api.example.com/v1?api_key=secret999&safe=1'
    );
    const result = await mod.captureException(err, {
      dsn,
      fetch: injectedFetch,
      handled: false,
      mechanismType: 'http.server',
      environment: 'staging',
      release: 'deadbeef',
      tags: { runtime: 'test' },
      request: {
        method: 'POST',
        url: 'https://perfectproperty.bid/api/enrich?token=tok_secret&id=42',
        headers: {
          authorization: 'Bearer secret-jwt',
          cookie: 'sid=xyz',
          'set-cookie': 'sid=abc',
          'x-edge-secret': 'edge-123',
          'x-scraper-admin-token': 'admin-456',
          'x-api-key': 'key-789',
          'user-agent': 'test-agent',
        },
      },
    });

    assert.equal(result.sent, true);
    assert.match(result.eventId, /^[a-f0-9]{32}$/);
    assert.equal(captured.length, 1);

    const [{ url, init }] = captured;
    assert.equal(url, 'https://o111.ingest.sentry.io/api/222333/envelope/');
    assert.equal(init.method, 'POST');
    assert.equal(init.headers['Content-Type'], 'application/x-sentry-envelope');
    assert.match(init.headers['X-Sentry-Auth'], /^Sentry sentry_version=7, /);
    assert.match(init.headers['X-Sentry-Auth'], /sentry_key=pubKey123/);
    assert.ok(init.signal, 'expected AbortSignal timeout on fetch call');

    const lines = init.body.trimEnd().split('\n');
    assert.equal(lines.length, 3);

    const envelopeHeader = JSON.parse(lines[0]);
    const itemHeader = JSON.parse(lines[1]);
    const eventBody = JSON.parse(lines[2]);

    assert.equal(envelopeHeader.event_id, result.eventId);
    assert.equal(envelopeHeader.dsn, dsn);
    assert.equal(itemHeader.type, 'event');
    assert.equal(itemHeader.content_type, 'application/json');
    assert.equal(itemHeader.length, new TextEncoder().encode(lines[2]).length);

    assert.equal(eventBody.event_id, result.eventId);
    assert.equal(eventBody.environment, 'staging');
    assert.equal(eventBody.release, 'deadbeef');
    assert.equal(eventBody.tags.runtime, 'test');
    assert.equal(eventBody.exception.values[0].type, 'TypeError');
    assert.equal(eventBody.exception.values[0].mechanism.handled, false);
    assert.doesNotMatch(eventBody.exception.values[0].value, /alice@example\.com/);
    assert.doesNotMatch(eventBody.exception.values[0].value, /secret999/);
    assert.match(eventBody.exception.values[0].value, /api_key=\[Filtered\]/);
    assert.match(eventBody.exception.values[0].value, /safe=1/);

    assert.equal(eventBody.request.headers.authorization, '[Filtered]');
    assert.equal(eventBody.request.headers.cookie, '[Filtered]');
    assert.equal(eventBody.request.headers['set-cookie'], '[Filtered]');
    assert.equal(eventBody.request.headers['x-edge-secret'], '[Filtered]');
    assert.equal(eventBody.request.headers['x-scraper-admin-token'], '[Filtered]');
    assert.equal(eventBody.request.headers['x-api-key'], '[Filtered]');
    assert.equal(eventBody.request.headers['user-agent'], 'test-agent');
    assert.doesNotMatch(eventBody.request.url, /tok_secret/);
    assert.match(eventBody.request.url, /token=\[Filtered\]/);
    assert.match(eventBody.request.url, /id=42/);
  }
});

test('captureException fails silently when fetch rejects or returns HTTP error', async () => {
  const tsSentry = await loadTsSentry();
  const dsn = 'https://pubKey123@o111.ingest.sentry.io/222333';

  for (const mod of [serverSentry, tsSentry]) {
    const networkFailure = await mod.captureException(new Error('boom'), {
      dsn,
      fetch: async () => {
        throw new Error('ECONNREFUSED');
      },
    });
    assert.equal(networkFailure.sent, false);
    assert.equal(networkFailure.reason, 'network_error');

    const httpFailure = await mod.captureException(new Error('boom'), {
      dsn,
      fetch: async () => ({ ok: false, status: 429 }),
    });
    assert.equal(httpFailure.sent, false);
    assert.equal(httpFailure.status, 429);
    assert.equal(httpFailure.reason, 'http_error');
  }
});

test('global-error.tsx, server/server.js, and .env.example wire and document Sentry telemetry', () => {
  const globalErrorSrc = fs.readFileSync(path.join(ROOT, 'src/app/global-error.tsx'), 'utf8');
  assert.match(globalErrorSrc, /captureException/);
  assert.match(globalErrorSrc, /@\/lib\/telemetry\/sentry/);

  const serverSrc = fs.readFileSync(path.join(ROOT, 'server/server.js'), 'utf8');
  assert.match(serverSrc, /require\(['"]\.\/telemetry\/sentry['"]\)/);
  assert.match(serverSrc, /captureException\(/);

  const envExample = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  assert.match(envExample, /^\s*#\s*SENTRY_DSN=/m);
  assert.match(envExample, /^\s*#\s*NEXT_PUBLIC_SENTRY_DSN=/m);
});
