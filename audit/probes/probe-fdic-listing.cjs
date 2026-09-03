// Probe FDIC real estate listings
const fs = require('fs');
const path = require('path');
const targets = [
  ['fdic-realestate-root', 'https://www.fdicrealestatelistings.com'],
  ['fdic-realestate-list', 'https://www.fdicrealestatelistings.com/listings'],
  ['fdic-realestate-search', 'https://www.fdicrealestatelistings.com/properties'],
  ['fdic-realestate-all', 'https://www.fdicrealestatelistings.com/all-properties'],
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
