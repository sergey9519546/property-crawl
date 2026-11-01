'use strict';

async function loadCountyInventory({ stateCode, county, apiUrl, fetchImpl = fetch, searchLocal } = {}) {
  const query = `state=${encodeURIComponent(stateCode)}&county=${encodeURIComponent(county)}&limit=250`;
  try {
    const response = await fetchImpl(`${apiUrl}/api/listings?${query}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error(`Inventory HTTP ${response.status}`);
    const data = await response.json();
    const listings = Array.isArray(data) ? data : data?.listings;
    if (!Array.isArray(listings) || data?.readError || data?.dataMode === 'unavailable') throw new Error('Inventory unavailable');
    return listings;
  } catch {
    try {
      const result = await searchLocal(query);
      if (!Array.isArray(result?.listings) || result.readError || result.dataMode === 'unavailable') throw new Error('Inventory unavailable');
      return result.listings;
    } catch {
      throw new Error('County inventory is temporarily unavailable. Try again shortly.');
    }
  }
}
module.exports = { loadCountyInventory };
