const db = require('../db/client');

async function handleExport(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const format = url.searchParams.get('format') || 'csv';
  const userId = req.headers['x-user-id'] || url.searchParams.get('userId');

  let items = [];
  if (userId) {
    items = await db.getSavedDeals(userId);
  } else {
    const all = await db.getListings({ limit: 100 });
    items = all.listings;
  }

  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="property_crawl_export.json"');
    return res.send(JSON.stringify(items, null, 2));
  }

  // CSV
  const headers = ['ID', 'Address', 'City', 'State', 'ZIP', 'Source', 'Opening Bid', 'Est Low', 'Est High', 'Deal Score', 'Sale Date', 'Plaintiff', 'Defendant', 'Deposit Terms'];
  const rows = items.map(l => [
    l.id, `"${(l.address||'').replace(/"/g, '""')}"`, `"${l.city||''}"`, l.state||'', l.zip||'',
    `"${l.source||''}"`, l.openingBid, l.estLow, l.estHigh, l.dealScore,
    l.saleDate, `"${(l.plaintiff||'').replace(/"/g, '""')}"`, `"${(l.defendant||'').replace(/"/g, '""')}"`,
    `"${(l.deposit||'').replace(/"/g, '""')}"`
  ].join(','));

  const csvContent = [headers.join(','), ...rows].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="property_crawl_export.csv"');
  return res.send(csvContent);
}

module.exports = handleExport;
