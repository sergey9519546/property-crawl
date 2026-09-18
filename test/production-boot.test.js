'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const startProduction = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'start-production.js'), 'utf8');

test('production orchestrator waits on liveness, not advanced readiness, for demo boot', () => {
  assert.match(startProduction, /\/api\/health['"`]/);
  assert.match(startProduction, /Demo\/in-memory mode detected/);
  assert.match(startProduction, /Advanced discovery readiness failed/);
  // Must not gate Next UI start on /api/health/ready.
  assert.doesNotMatch(
    startProduction,
    /await waitForHealth\(`http:\/\/127\.0\.0\.1:\$\{publicPort\}\/api\/health\/ready`\)/
  );
  assert.match(
    startProduction,
    /await waitForHealth\(`http:\/\/127\.0\.0\.1:\$\{publicPort\}\/api\/health`\)/
  );
});

test('operator token alias PROPERTY_OPERATOR_SECRET resolves when primary unset', () => {
  const { resolveOperatorToken } = require('../server/security/operator-token');
  assert.equal(resolveOperatorToken({ SCRAPER_ADMIN_TOKEN: 'primary' }), 'primary');
  assert.equal(resolveOperatorToken({ PROPERTY_OPERATOR_SECRET: 'alias' }), 'alias');
  assert.equal(resolveOperatorToken({}), '');
});

test('fly.toml production port matches Dockerfile.production', () => {
  const fly = fs.readFileSync(path.join(__dirname, '..', 'fly.toml'), 'utf8');
  const docker = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile.production'), 'utf8');
  assert.match(fly, /internal_port\s*=\s*3000/);
  assert.match(fly, /dockerfile\s*=\s*'Dockerfile\.production'/);
  assert.match(docker, /EXPOSE 3000/);
});

test('marketing nav points at shipped routes, not phantom product names', () => {
  const header = fs.readFileSync(path.join(__dirname, '..', 'src/components/site/site-header.tsx'), 'utf8');
  assert.doesNotMatch(header, /Deal Stacks/);
  assert.doesNotMatch(header, /Shadow Mode/);
  assert.doesNotMatch(header, /Prophecy/);
  assert.match(header, /href: "\/listings"/);
  assert.match(header, /href: "\/sources"/);
  assert.match(header, /href: "\/sign-in"/);
});

test('homepage marketing does not ship phantom product names or accuracy guarantees', () => {
  for (const rel of [
    'src/components/site/gtm.tsx',
    'src/components/site/ai-knows.tsx',
    'src/components/site/site-footer.tsx',
  ]) {
    const text = fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
    assert.doesNotMatch(text, /Deal Stacks/);
    assert.doesNotMatch(text, /Shadow Mode/);
    assert.doesNotMatch(text, /Prophecy/);
    assert.doesNotMatch(text, /accuracy report/i);
  }
  const aiKnows = fs.readFileSync(path.join(__dirname, '..', 'src/components/site/ai-knows.tsx'), 'utf8');
  assert.match(aiKnows, /Evidence first/i);
  assert.match(aiKnows, /optional/i);
});

test('/workspace index redirects to the private review queue', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'src/app/workspace/page.tsx'), 'utf8');
  assert.match(page, /redirect\("\/workspace\/documents-review"\)/);
});

test('contact page does not promise human replies without delivery', () => {
  const slug = fs.readFileSync(path.join(__dirname, '..', 'src/app/[slug]/page.tsx'), 'utf8');
  assert.doesNotMatch(slug, /Expect a response before public launch/);
  assert.match(slug, /webhook is configured|webhook endpoint/i);
});

test('document-review API and Next proxies require operator identity', () => {
  const api = fs.readFileSync(path.join(__dirname, '..', 'server/routes/document-review.js'), 'utf8');
  assert.match(api, /requireOperator/);
  const nextRoute = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/document-review/route.ts'), 'utf8');
  assert.match(nextRoute, /proxyPrivatePropertyApi/);
  const allowlist = fs.readFileSync(path.join(__dirname, '..', 'src/lib/property-api.ts'), 'utf8');
  assert.match(allowlist, /document-review/);
});

test('Next security headers are declared for the canonical UI', () => {
  const config = fs.readFileSync(path.join(__dirname, '..', 'next.config.mjs'), 'utf8');
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /X-Frame-Options/);
  assert.match(config, /poweredByHeader:\s*false/);
});

test('API rate policy wires TRUSTED_PROXY_COUNT into limiters', () => {
  const policy = fs.readFileSync(path.join(__dirname, '..', 'server/security/api-rate-policy.js'), 'utf8');
  assert.match(policy, /TRUSTED_PROXY_COUNT/);
  assert.match(policy, /trustedProxyCount/);
});

test('legacy UI URL sinks only emit http(s) schemes', () => {
  const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  assert.match(app, /function safeHttpUrl/);
  assert.match(app, /safeHttpUrl\(l\.sourceUrl\)/);
  assert.match(app, /safeHttpUrl\(l\.photo\)/);
});

test('scrapers Next mutations use the private session proxy', () => {
  const scrapers = fs.readFileSync(path.join(__dirname, '..', 'src/app/api/scrapers/route.ts'), 'utf8');
  assert.match(scrapers, /proxyPrivatePropertyApi/);
});

