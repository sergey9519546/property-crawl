import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import {
  WorkspaceUnlockLimiter,
  workspaceUnlockBucket,
  extractClientIp,
} from '../src/lib/workspace-unlock-limiter.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function loadWorkspaceModules() {
  const cache = new Map();
  function loadTs(relPath, customMocks = {}) {
    const absPath = path.resolve(ROOT, relPath);
    if (cache.has(absPath)) return cache.get(absPath).exports;
    const source = fs.readFileSync(absPath, 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
      fileName: absPath,
    });
    const mod = { exports: {} };
    cache.set(absPath, mod);
    const localRequire = (spec) => {
      if (spec in customMocks) return customMocks[spec];
      if (spec === 'server-only') return {};
      if (spec.startsWith('@/')) {
        const target = path.join('src', `${spec.slice(2)}.ts`);
        return loadTs(target, customMocks);
      }
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const base = path.dirname(absPath);
        const tsCandidate = path.relative(ROOT, path.resolve(base, `${spec}.ts`));
        if (fs.existsSync(path.join(ROOT, tsCandidate))) {
          return loadTs(tsCandidate, customMocks);
        }
      }
      return require(spec);
    };
    const fn = new Function('require', 'module', 'exports', '__filename', '__dirname', outputText);
    fn(localRequire, mod, mod.exports, absPath, path.dirname(absPath));
    return mod.exports;
  }

  const mocks = {
    '@/lib/member-account': { currentMember: async () => null },
  };
  const clientIpMod = loadTs('src/lib/client-ip.ts', mocks);
  const workspaceSessionMod = loadTs('src/lib/workspace-session.ts', mocks);
  const routeMod = loadTs('src/app/api/workspace/session/route.ts', mocks);
  return { clientIpMod, workspaceSessionMod, routeMod };
}

test('workspace unlock attempts are bounded and report retry timing', () => {
  let now = 10_000;
  const limiter = new WorkspaceUnlockLimiter(3, 30_000, () => now);
  for (let index = 0; index < 3; index += 1) {
    assert.equal(limiter.check('ip:198.51.100.10').allowed, true);
    limiter.recordFailure('ip:198.51.100.10');
  }
  assert.deepEqual(limiter.check('ip:198.51.100.10'), { allowed: false, retryAfterSeconds: 30 });
  now += 29_001;
  assert.equal(limiter.check('ip:198.51.100.10').retryAfterSeconds, 1);
  now += 999;
  assert.deepEqual(limiter.check('ip:198.51.100.10'), { allowed: true, retryAfterSeconds: 0 });
});

test('client-controlled headers cannot mint unlimited unlock buckets when proxy is untrusted', () => {
  const limiter = new WorkspaceUnlockLimiter(1, 60_000, () => 20_000);
  limiter.recordFailure('ip:unknown');
  assert.equal(limiter.check('ip:unknown').allowed, false);
  limiter.reset('ip:unknown');
  assert.equal(limiter.check('ip:unknown').allowed, true);

  const env = { TRUSTED_PROXY_COUNT: '' };
  const withSid = new Request('https://app.example/api/workspace/session', {
    headers: { 'x-unlock-sid': 'attacker-rotates-this' },
  });
  const withForwarded = new Request('https://app.example/api/workspace/session', {
    headers: { 'x-forwarded-for': '203.0.113.1', 'x-unlock-sid': 'another-id' },
  });
  const bare = new Request('https://app.example/api/workspace/session');
  assert.equal(workspaceUnlockBucket(withSid, env), 'ip:unknown');
  assert.equal(workspaceUnlockBucket(withForwarded, env), 'ip:unknown');
  assert.equal(workspaceUnlockBucket(bare, env), 'ip:unknown');
});

test('unlock rate limiter isolates distinct client IPs behind trusted proxies or socket remoteAddress', () => {
  const { clientIpMod } = loadWorkspaceModules();
  const proxyEnv = { TRUSTED_PROXY_COUNT: '1' };
  const attackerReq = new Request('https://app.example/api/workspace/session', {
    headers: { 'x-forwarded-for': '192.0.2.99, 203.0.113.10' },
  });
  const operatorReq = new Request('https://app.example/api/workspace/session', {
    headers: { 'x-forwarded-for': '198.51.100.42' },
  });

  const attackerBucket = workspaceUnlockBucket(attackerReq, proxyEnv);
  const operatorBucket = workspaceUnlockBucket(operatorReq, proxyEnv);
  assert.equal(attackerBucket, 'ip:203.0.113.10');
  assert.equal(operatorBucket, 'ip:198.51.100.42');
  assert.equal(clientIpMod.getClientIp(attackerReq, proxyEnv), '203.0.113.10');

  const limiter = new WorkspaceUnlockLimiter(2, 60_000, () => 30_000);
  limiter.recordFailure(attackerBucket);
  limiter.recordFailure(attackerBucket);
  assert.equal(limiter.check(attackerBucket).allowed, false);
  assert.equal(limiter.check(operatorBucket).allowed, true);

  // Two trusted proxies: second from right is chosen, left spoofing ignored.
  assert.equal(
    extractClientIp(
      { headers: { 'x-forwarded-for': '1.2.3.4, 203.0.113.77, 10.0.0.2' } },
      { TRUSTED_PROXY_COUNT: '2' },
    ),
    '203.0.113.77',
  );

  // Without TRUSTED_PROXY_COUNT, socket.remoteAddress wins over spoofed X-Forwarded-For.
  const socketReq = {
    headers: { 'x-forwarded-for': '203.0.113.250' },
    socket: { remoteAddress: '::ffff:198.51.100.88' },
  };
  assert.equal(extractClientIp(socketReq, { TRUSTED_PROXY_COUNT: '0' }), '198.51.100.88');
  assert.equal(clientIpMod.rateLimitKey('contact', socketReq, undefined, {}), 'form:contact:198.51.100.88');
});

test('POST /api/workspace/session issues role-scoped v2 cookies and blocks privilege escalation', async () => {
  const { workspaceSessionMod, routeMod } = loadWorkspaceModules();
  const prevEnv = {
    SCRAPER_ADMIN_TOKEN: process.env.SCRAPER_ADMIN_TOKEN,
    PROPERTY_ANALYST_SECRET: process.env.PROPERTY_ANALYST_SECRET,
    PROPERTY_VIEWER_SECRET: process.env.PROPERTY_VIEWER_SECRET,
    TRUSTED_PROXY_COUNT: process.env.TRUSTED_PROXY_COUNT,
  };

  process.env.SCRAPER_ADMIN_TOKEN = 'op-secret-token-123';
  process.env.PROPERTY_ANALYST_SECRET = 'analyst-secret-token-456';
  process.env.PROPERTY_VIEWER_SECRET = 'viewer-secret-token-789';
  process.env.TRUSTED_PROXY_COUNT = '1';

  const makePost = (body, ip) => new Request('http://127.0.0.1:3001/api/workspace/session', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'http://127.0.0.1:3001',
      'x-forwarded-for': ip,
    },
    body: JSON.stringify(body),
  });

  const cookieHeaderFrom = (res) => {
    const raw = res.headers.get('set-cookie') || '';
    return raw.split(';')[0];
  };

  try {
    // 1. Operator credential yields operator v2 cookie (backwards compatible)
    const opRes = await routeMod.POST(makePost({ credential: 'op-secret-token-123' }, '203.0.113.10'));
    assert.equal(opRes.status, 200);
    const opJson = await opRes.json();
    assert.equal(opJson.authenticated, true);
    assert.equal(opJson.role, 'operator');
    const opSession = workspaceSessionMod.readWorkspaceSession(
      new Request('http://127.0.0.1:3001/api/workspace/session', {
        headers: { cookie: cookieHeaderFrom(opRes) },
      }),
    );
    assert.equal(opSession.authenticated, true);
    assert.equal(opSession.role, 'operator');

    // 2. Analyst credential yields analyst v2 cookie
    const analystRes = await routeMod.POST(makePost({ credential: 'analyst-secret-token-456' }, '203.0.113.11'));
    assert.equal(analystRes.status, 200);
    const analystJson = await analystRes.json();
    assert.equal(analystJson.role, 'analyst');
    const analystSession = workspaceSessionMod.readWorkspaceSession(
      new Request('http://127.0.0.1:3001/api/workspace/session', {
        headers: { cookie: cookieHeaderFrom(analystRes) },
      }),
    );
    assert.equal(analystSession.role, 'analyst');

    // 3. Viewer credential yields viewer v2 cookie
    const viewerRes = await routeMod.POST(makePost({ credential: 'viewer-secret-token-789' }, '203.0.113.12'));
    assert.equal(viewerRes.status, 200);
    assert.equal((await viewerRes.json()).role, 'viewer');

    // 4. Operator downscoping via prefixed or JSON role-bound token works
    const downRes = await routeMod.POST(makePost({ credential: 'analyst:op-secret-token-123' }, '203.0.113.13'));
    assert.equal(downRes.status, 200);
    assert.equal((await downRes.json()).role, 'analyst');

    const jsonDownRes = await routeMod.POST(
      makePost({ credential: JSON.stringify({ role: 'viewer', token: 'op-secret-token-123' }) }, '203.0.113.14'),
    );
    assert.equal(jsonDownRes.status, 200);
    assert.equal((await jsonDownRes.json()).role, 'viewer');

    // 5. Escalation attempts fail closed with 403
    const esc1 = await routeMod.POST(makePost({ credential: 'analyst-secret-token-456', role: 'operator' }, '203.0.113.15'));
    assert.equal(esc1.status, 403);
    const esc2 = await routeMod.POST(makePost({ credential: 'operator:viewer-secret-token-789' }, '203.0.113.16'));
    assert.equal(esc2.status, 403);
    const badRole = await routeMod.POST(makePost({ credential: 'op-secret-token-123', role: 'superadmin' }, '203.0.113.17'));
    assert.equal(badRole.status, 400);

    // 6. Rate limiting one attacker IP does not block a different operator IP
    for (let i = 0; i < 5; i += 1) {
      const bad = await routeMod.POST(makePost({ credential: 'wrong-pass' }, '203.0.113.99'));
      assert.equal(bad.status, 401);
    }
    const locked = await routeMod.POST(makePost({ credential: 'wrong-pass' }, '203.0.113.99'));
    assert.equal(locked.status, 429);

    const otherOperator = await routeMod.POST(makePost({ credential: 'op-secret-token-123' }, '198.51.100.50'));
    assert.equal(otherOperator.status, 200);
  } finally {
    for (const [k, v] of Object.entries(prevEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
