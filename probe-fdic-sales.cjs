// Try FDIC sales application
const fs = require('fs');
const path = require('path');
const targets = [
  ['fdic-sales-closedre', 'https://sales.fdic.gov/closedrealestate/'],
  ['fdic-sales-closedsales', 'https://sales.fdic.gov/closedsales/'],
  ['fdic-sales-root', 'https://sales.fdic.gov/'],
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
