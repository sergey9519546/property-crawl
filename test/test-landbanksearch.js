const t = require('../server/scrapers/landbanksearch');
t.scrapeFeed()
  .then((r) => {
    console.log('Got', r.length, 'listings');
    if (r[0]) console.log(JSON.stringify(r[0], null, 2));
  })
  .catch((e) => {
    console.error('ERR:', e.message);
    process.exit(1);
  });
