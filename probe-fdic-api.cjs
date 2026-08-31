// Try FDIC sales API
const fs = require('fs');
const path = require('path');
const targets = [
  ['fdic-api-root', 'https://sales.fdic.gov/api/'],
  ['fdic-api-sales', 'https://sales.fdic.gov/api/sales'],
  ['fdic-api-listing', 'https://sales.fdic.gov/api/listings'],
  ['fdic-api-search', 'https://sales.fdic.gov/api/search'],
  ['fdic-api-cscre', 'https://sales.fdic.gov/api/cscre'],
];
(async () => {
  for (const [name, url] of targets) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 30000);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' },
        signal: c.signal
      });
      const text = await r.text();
      const out = path.join(__dirname, `${name}.txt`);
      fs.writeFileSync(out, `status: ${r.status}, len: ${text.length}\nurl: ${url}\n\n` + text);
      console.log(`${name}: status=${r.status} len=${text.length}`);
    } catch (e) {
      console.log(`${name}: ERR ${e.message}`);
    } finally {
      clearTimeout(t);
    }
  }
})();
