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

test('session cookie Secure flag follows request protocol, not NODE_ENV alone', () => {
  const session = fs.readFileSync(path.join(__dirname, '..', 'src/lib/workspace-session.ts'), 'utf8');
  assert.match(session, /cookieIsSecure/);
  assert.match(session, /PROPERTY_OPERATOR_SECRET/);
  assert.match(session, /WORKSPACE_SESSION_EPOCH/);
  assert.doesNotMatch(session, /NODE_ENV === "production" \|\| new URL\(request\.url\)\.protocol === "https:"/);
});

test('form persistence fails soft when cache is not writable', () => {
  const forms = fs.readFileSync(path.join(__dirname, '..', 'src/lib/form-submissions.js'), 'utf8');
  assert.match(forms, /unavailable/);
  assert.match(forms, /storeError/);
  const docker = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile.production'), 'utf8');
  assert.match(docker, /mkdir -p \/app\/\.cache/);
});

test('legacy index.html does not load third-party puter/tailwind CDNs', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*puter/i);
  assert.doesNotMatch(html, /<script[^>]+src=["'][^"']*tailwindcss/i);
});

test('render.yaml does not independently generate divergent operator aliases', () => {
  const render = fs.readFileSync(path.join(__dirname, '..', 'render.yaml'), 'utf8');
  assert.match(render, /key: SCRAPER_ADMIN_TOKEN\s*\n\s*generateValue: true/);
  // PROPERTY_OPERATOR_SECRET must not also generateValue independently.
  const aliasBlock = render.split('PROPERTY_OPERATOR_SECRET')[1] || '';
  assert.doesNotMatch(aliasBlock.slice(0, 80), /generateValue:\s*true/);
});

test('SEO schema and social proof do not overclaim partnerships or AI omniscience', () => {
  const seo = fs.readFileSync(path.join(__dirname, '..', 'src/components/site/seo-schema.tsx'), 'utf8');
  assert.doesNotMatch(seo, /Zillow for distressed/);
  assert.doesNotMatch(seo, /AI that reads the fine print/);
  const proof = fs.readFileSync(path.join(__dirname, '..', 'src/components/site/social-proof.tsx'), 'utf8');
  assert.match(proof, /not customer logos|not endorsements/i);
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

test('legacy marketing shells do not overclaim AI omniscience', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.doesNotMatch(html, /AI that reads the fine print/);
  assert.doesNotMatch(html, /Zillow for distressed/);
  const manifest = fs.readFileSync(path.join(__dirname, '..', 'manifest.json'), 'utf8');
  assert.doesNotMatch(manifest, /Zillow for distressed/);
  assert.doesNotMatch(manifest, /AI that reads the fine print/);
});

test('listings API exports intelligence view for quality/opportunity sorts', () => {
  const listings = fs.readFileSync(path.join(__dirname, '..', 'server/routes/listings.js'), 'utf8');
  assert.match(listings, /applyIntelligenceView/);
  assert.match(listings, /module\.exports\.applyIntelligenceView/);
  assert.match(listings, /minQuality/);
  const workbench = fs.readFileSync(path.join(__dirname, '..', 'src/components/listings/discovery-workbench.tsx'), 'utf8');
  assert.match(workbench, /value="quality"/);
  assert.match(workbench, /value="opportunity"/);
  assert.match(workbench, /minQuality/);
});

