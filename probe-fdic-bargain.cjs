// fetch FDIC bargain properties + a few other variants
const fs = require('fs');
const path = require('path');
const targets = [
  ['fdic-bargain', 'https://www.fdic.gov/asset-sales/bargain-properties'],
  ['fdic-historical', 'https://www.fdic.gov/asset-sales/historical-sales'],
  ['fdic-events', 'https://www.fdic.gov/asset-sales/events'],
  ['fdic-other', 'https://www.fdic.gov/asset-sales/other-asset-sales'],
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
      const out = path.join(__dirname, `fdic-${name.split('-')[1]}.html`);
      fs.writeFileSync(out, `status: ${r.status}, len: ${text.length}\n\n` + text);
      console.log(`${name}: status=${r.status} len=${text.length} -> ${out}`);
    } catch (e) {
      console.log(`${name}: ERR ${e.message}`);
    } finally {
      clearTimeout(t);
    }
  }
})();
