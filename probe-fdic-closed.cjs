// Try FDIC closed real estate sales
const fs = require('fs');
const path = require('path');
const targets = [
  ['fdic-closed-app', 'https://www.fdic.gov/asset-sales/closed-real-estate-sales'],
  ['fdic-closed-search', 'https://closedrealestatesales.fdic.gov'],
  ['fdic-closed-app2', 'https://www7.fdic.gov/closedrealsales/'],
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
      const out = path.join(__dirname, `${name}.html`);
      fs.writeFileSync(out, `status: ${r.status}, len: ${text.length}\nurl: ${url}\n\n` + text);
      console.log(`${name}: status=${r.status} len=${text.length}`);
    } catch (e) {
      console.log(`${name}: ERR ${e.message}`);
    } finally {
      clearTimeout(t);
    }
  }
})();
