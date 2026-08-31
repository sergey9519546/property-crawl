// Try the FDIC closedrealestate endpoints
const fs = require('fs');
const path = require('path');
(async () => {
  const targets = [
    'https://sales.fdic.gov/api/closedrealestate',
    'https://sales.fdic.gov/api/closedrealestate/',
    'https://sales.fdic.gov/api/closedrealestate/sales',
    'https://sales.fdic.gov/api/closedrealestate/listings',
    'https://sales.fdic.gov/api/realestate',
    'https://sales.fdic.gov/api/closedsales',
    'https://sales.fdic.gov/api/sales',
  ];
  for (const url of targets) {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 30000);
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)', 'Accept': 'application/json' },
        signal: c.signal
      });
      const text = await r.text();
      console.log(`${url} -> status=${r.status} len=${text.length}`);
      if (text.length < 2000) console.log('  body:', text.substring(0, 500));
    } catch (e) {
      console.log(`${url} ERR: ${e.message}`);
    } finally {
      clearTimeout(t);
    }
  }
})();
