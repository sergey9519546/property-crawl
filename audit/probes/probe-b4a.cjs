// Try Bid4Assets with various headers
const fs = require('fs');
const path = require('path');
const targets = [
  ['b4a-root', 'https://www.bid4assets.com/'],
  ['b4a-auction-1308995', 'https://www.bid4assets.com/auction/1308995'],
  ['b4a-real-estate', 'https://www.bid4assets.com/real-estate-auctions'],
  ['b4a-sheriff', 'https://www.bid4assets.com/sheriffsales'],
];
const headers = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.5',
  'Accept-Encoding': 'gzip, deflate, br',
  'Connection': 'keep-alive',
  'Upgrade-Insecure-Requests': '1',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'none',
  'Sec-Fetch-User': '?1',
  'TE': 'trailers',
};
(async () => {
  for (const [name, url] of targets) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 30000);
    try {
      const r = await fetch(url, { headers, signal: c.signal });
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
