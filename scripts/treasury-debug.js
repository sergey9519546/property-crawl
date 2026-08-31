// Quick smoke test for treasury scraper — limits to 2 properties.
const t = require('../server/scrapers/treasury');

(async () => {
  try {
    console.log('Fetching listing page...');
    const html = await t.fetchText('https://www.treasury.gov/auctions/treasury/rp/realprop.shtml');
    console.log('Got', html.length, 'chars');

    const slugRegex = /href="([^"]+\.shtml)"/g;
    const excludeRegex = /include|top-nav|footer|howto|contact|press|broker|carolina/i;
    const slugs = [...new Set([...html.matchAll(slugRegex)].map(m => m[1]))]
      .filter(s => !excludeRegex.test(s));
    console.log('Found', slugs.length, 'slugs:', slugs);

    const first = slugs.slice(0, 2);
    for (const slug of first) {
      console.log('\n--- Testing', slug, '---');
      const start = Date.now();
      try {
        const r = await t.fetchDetail(slug);
        const ms = Date.now() - start;
        console.log('OK in', ms, 'ms');
        if (r) {
          console.log('  id:', r.id);
          console.log('  address:', r.address);
          console.log('  state:', r.state, 'zip:', r.zip);
          console.log('  openingBid:', r.openingBid);
          console.log('  sqft:', r.sqft, 'beds:', r.beds, 'baths:', r.baths, 'year:', r.year);
          console.log('  saleDate:', r.saleDate);
          console.log('  sourceUrl:', r.sourceUrl);
        } else {
          console.log('  (null result)');
        }
      } catch (err) {
        console.log('  FAILED:', err.message);
      }
    }
  } catch (e) {
    console.error('TOP ERR:', e);
  }
})();
