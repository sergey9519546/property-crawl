// fetch full FDIC page
const fs = require('fs');
const path = require('path');
(async () => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30000);
  try {
    const r = await fetch('https://www.fdic.gov/asset-sales/real-estate-and-property-sales', {
      headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' },
      signal: c.signal
    });
    const text = await r.text();
    fs.writeFileSync(path.join(__dirname, 'fdic-full.html'), `status: ${r.status}, len: ${text.length}\n\n` + text);
    console.log('fdic-full.html written', text.length);
  } catch (e) {
    console.log('ERR:', e.message);
  } finally {
    clearTimeout(t);
  }
})();
