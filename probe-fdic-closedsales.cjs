// Get FDIC closed real estate sales API sample
const fs = require('fs');
const path = require('path');
(async () => {
  // closedsales is 360KB — manageable
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 30000);
  const r = await fetch('https://sales.fdic.gov/api/closedsales', {
    headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' },
    signal: c.signal
  });
  const text = await r.text();
  clearTimeout(t);
  fs.writeFileSync(path.join(__dirname, 'fdic-closedsales.json'), text);
  console.log('closedsales written', text.length);
  // First 2000 chars
  console.log(text.substring(0, 3000));
  console.log('---');
  // closedrealestate is 2.5MB - get head
  const c2 = new AbortController();
  const t2 = setTimeout(() => c2.abort(), 60000);
  const r2 = await fetch('https://sales.fdic.gov/api/closedrealestate', {
    headers: { 'User-Agent': 'property-crawl-bot/1.0 (research; contact: ops@property-crawl.example)' },
    signal: c2.signal
  });
  const text2 = await r2.text();
  clearTimeout(t2);
  fs.writeFileSync(path.join(__dirname, 'fdic-closedrealestate.json'), text2);
  console.log('closedrealestate written', text2.length);
  console.log(text2.substring(0, 2000));
})();
