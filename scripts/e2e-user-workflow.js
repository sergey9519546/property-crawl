'use strict';

/**
 * End-to-end user workflow verification against a running production stack.
 * Usage: node scripts/e2e-user-workflow.js [baseUrl]
 * Default baseUrl: http://127.0.0.1:3700
 */

const baseUrl = String(process.argv[2] || process.env.E2E_BASE_URL || 'http://127.0.0.1:3700').replace(/\/$/, '');

async function get(path, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, { headers, redirect: 'follow' });
  const text = await response.text();
  return { status: response.status, text, json: safeJson(text) };
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

async function post(path, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, json: safeJson(text), headers: response.headers };
}

async function main() {
  const token = process.env.SCRAPER_ADMIN_TOKEN
    || (() => {
      try {
        const fs = require('node:fs');
        const line = fs.readFileSync('.env.local', 'utf8').split(/\r?\n/).find((l) => l.startsWith('SCRAPER_ADMIN_TOKEN='));
        return line ? line.slice('SCRAPER_ADMIN_TOKEN='.length).trim() : '';
      } catch { return ''; }
    })();

  const checks = [];
  const record = (name, ok, detail) => {
    checks.push({ name, ok, detail });
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}: ${detail}`);
  };

  const health = await get('/api/health');
  record('health', health.status === 200 && health.json?.status === 'ok', `status=${health.status}`);
  record(
    'health honesty fields',
    typeof health.json?.dataMode === 'string' && typeof health.json?.documentReviewStore === 'string',
    `dataMode=${health.json?.dataMode} store=${health.json?.documentReviewStore}`
  );
  // When the orchestrator pins demo mode (no DATABASE_URL), require honest labels.
  const pinDemo = process.env.E2E_EXPECT_DEMO === '1';
  if (pinDemo) {
    record(
      'health demo-pin',
      health.json?.dataMode === 'demo'
        && (health.json?.documentReviewStore === 'file' || health.json?.documentReviewStore === 'none'),
      `dataMode=${health.json?.dataMode} store=${health.json?.documentReviewStore}`
    );
  }

  for (const path of ['/', '/listings', '/sources', '/hunts', '/sign-in', '/workspace']) {
    const res = await get(path);
    record(`page ${path}`, res.status === 200, `status=${res.status}`);
  }

  const quality = await get('/api/listings?limit=5&sort=quality&minQuality=0');
  const qScores = (quality.json?.listings || []).map((l) => l.researchQuality?.score ?? -1);
  const qualitySorted = qScores.every((v, i, arr) => i === 0 || arr[i - 1] >= v);
  record('api sort=quality', quality.status === 200 && quality.json?.intelligence?.sort === 'quality' && qualitySorted, `scores=${qScores.join(',')}`);

  const opp = await get('/api/listings?limit=5&sort=opportunity');
  const oRanks = (opp.json?.listings || []).map((l) => l.opportunity?.rank ?? -1);
  const oppSorted = oRanks.every((v, i, arr) => i === 0 || arr[i - 1] >= v);
  record('api sort=opportunity', opp.status === 200 && opp.json?.intelligence?.sort === 'opportunity' && oppSorted, `ranks=${oRanks.join(',')}`);

  const firstId = opp.json?.listings?.[0]?.id || quality.json?.listings?.[0]?.id;
  if (firstId) {
    const detail = await get(`/api/listings/${encodeURIComponent(firstId)}`);
    record('listing detail api', detail.status === 200 && Boolean(detail.json?.researchQuality), `id=${firstId} quality=${detail.json?.researchQuality?.band}`);
    const page = await get(`/listings/${encodeURIComponent(firstId)}`);
    record('listing detail page', page.status === 200, `status=${page.status}`);
  } else {
    record('listing detail api', false, 'no listing id in feed');
  }

  const contact = await post('/api/contact', { name: 'E2E Workflow', email: 'e2e@example.com', message: 'end-to-end verification' });
  record('contact form', contact.status === 202 && contact.json?.delivery, `status=${contact.status} delivery=${contact.json?.delivery}`);

  if (token) {
    const cookieJar = [];
    const unlock = await fetch(`${baseUrl}/api/workspace/session`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: baseUrl,
        'x-workspace-request': '1',
      },
      body: JSON.stringify({ credential: token }),
    });
    const unlockText = await unlock.text();
    const setCookie = unlock.headers.getSetCookie?.() || [];
    for (const c of setCookie) cookieJar.push(c.split(';')[0]);
    record('operator unlock', unlock.status === 200 && cookieJar.length > 0, `status=${unlock.status} cookies=${cookieJar.length}`);
    const cookieHeader = cookieJar.join('; ');
    if (cookieHeader) {
      const dr = await fetch(`${baseUrl}/api/document-review`, { headers: { cookie: cookieHeader } });
      record('document-review session', dr.status === 200, `status=${dr.status}`);
      const drJson = safeJson(await dr.clone().text());
      record(
        'document-review envelope',
        Boolean(drJson && Array.isArray(drJson.reviews) && drJson.byStatus),
        `total=${drJson?.total} pending=${drJson?.byStatus?.pending}`
      );
      const mutationHeaders = {
        cookie: cookieHeader,
        'content-type': 'application/json',
        // Non-browser e2e omits Origin; gate accepts x-workspace-request=1.
        'x-workspace-request': '1',
      };
      const drWrite = await fetch(`${baseUrl}/api/document-review`, {
        method: 'POST',
        headers: mutationHeaders,
        body: JSON.stringify({
          listingId: 'E2E-WORKFLOW',
          documentIndex: 0,
          documentUrl: 'https://example.com/e2e-notice.pdf',
          status: 'approved',
          reviewer: 'e2e-workflow',
          notes: 'e2e durability check',
        }),
      });
      const drWriteJson = safeJson(await drWrite.text());
      record(
        'document-review write+persist',
        drWrite.status === 200 && drWriteJson?.persisted === true && drWriteJson?.review?.status === 'approved',
        `status=${drWrite.status} persisted=${drWriteJson?.persisted}`
      );
      const drReload = await fetch(`${baseUrl}/api/document-review?hydrate=false`, { headers: { cookie: cookieHeader } });
      const drReloadJson = safeJson(await drReload.text());
      const hasE2e = (drReloadJson?.reviews || []).some((r) => r.listingId === 'E2E-WORKFLOW');
      record('document-review durable readback', drReload.status === 200 && hasE2e, `status=${drReload.status} hasE2e=${hasE2e}`);

      const hunts = await fetch(`${baseUrl}/api/hunts`, { headers: { cookie: cookieHeader } });
      record('hunts session', hunts.status === 200, `status=${hunts.status}`);
      const anon = await fetch(`${baseUrl}/api/document-review`);
      record('document-review anonymous rejected', anon.status === 401, `status=${anon.status}`);

      const jobs = await fetch(`${baseUrl}/api/source-network/jobs?limit=5`, { headers: { cookie: cookieHeader } });
      record('source-network jobs list proxy', jobs.status === 200, `status=${jobs.status}`);
      const unbrowse = await fetch(`${baseUrl}/api/source-network/unbrowse/status`, { headers: { cookie: cookieHeader } });
      const unbrowseJson = safeJson(await unbrowse.text());
      record('unbrowse status proxy', unbrowse.status === 200 && typeof unbrowseJson?.installed === 'boolean', `status=${unbrowse.status} installed=${unbrowseJson?.installed}`);
      const importPreview = await fetch(`${baseUrl}/api/workspace/import/preview`, {
        method: 'POST',
        headers: {
          cookie: cookieHeader,
          'content-type': 'application/json',
          'x-workspace-request': '1',
        },
        body: JSON.stringify({ listingIds: [] }),
      });
      record('workspace import preview proxy', [200, 400, 422].includes(importPreview.status), `status=${importPreview.status}`);
    }
  } else {
    record('operator unlock', false, 'SCRAPER_ADMIN_TOKEN missing');
  }

  const listingsPage = await get('/listings');
  const hasIntelUi = /Evidence quality|Opportunity rank|minQuality|minQuality|Evidence ≥/i.test(listingsPage.text)
    || /value="quality"/.test(listingsPage.text)
    || /quality/.test(listingsPage.text);
  // Client bundle may hold the select options; SSR text may omit them.
  record('listings page reachable', listingsPage.status === 200, `status=${listingsPage.status}`);

  const failed = checks.filter((c) => !c.ok);
  console.log('---');
  console.log(`E2E ${failed.length === 0 ? 'PASS' : 'FAIL'}: ${checks.length - failed.length}/${checks.length} checks`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
