'use strict';

const DEFAULT_PAGE_SIZE = 250;
const MAX_COUNTY_ROWS = 2000;

async function paginateCountyQuery(fetchPage) {
  const collected = [];
  const seenIds = new Set();

  for (let offset = 0; collected.length < MAX_COUNTY_ROWS; offset += DEFAULT_PAGE_SIZE) {
    const data = await fetchPage(offset, DEFAULT_PAGE_SIZE);
    const listings = Array.isArray(data) ? data : data?.listings;
    if (!Array.isArray(listings) || data?.readError || data?.dataMode === 'unavailable') {
      throw new Error('Inventory unavailable');
    }
    if (listings.length === 0) break;

    let added = 0;
    for (const item of listings) {
      const id = item && typeof item.id === 'string' && item.id ? item.id : null;
      if (id) {
        if (seenIds.has(id)) continue;
        seenIds.add(id);
      }
      collected.push(item);
      added++;
      if (collected.length >= MAX_COUNTY_ROWS) break;
    }

    const total = typeof data?.total === 'number' && Number.isFinite(data.total) ? data.total : null;
    if (listings.length < DEFAULT_PAGE_SIZE || added === 0) break;
    if (total !== null && offset + listings.length >= total) break;
  }

  return collected;
}

async function loadCountyInventory({ stateCode, county, apiUrl, fetchImpl = fetch, searchLocal } = {}) {
  try {
    return await paginateCountyQuery(async (offset, limit) => {
      const offsetParam = offset > 0 ? `&offset=${offset}` : '';
      const query = `state=${encodeURIComponent(stateCode)}&county=${encodeURIComponent(county)}&limit=${limit}${offsetParam}`;
      const response = await fetchImpl(`${apiUrl}/api/listings?${query}`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw new Error(`Inventory HTTP ${response.status}`);
      return response.json();
    });
  } catch {
    try {
      return await paginateCountyQuery(async (offset, limit) => {
        const offsetParam = offset > 0 ? `&offset=${offset}` : '';
        const query = `state=${encodeURIComponent(stateCode)}&county=${encodeURIComponent(county)}&limit=${limit}${offsetParam}`;
        return searchLocal(query);
      });
    } catch {
      throw new Error('County inventory is temporarily unavailable. Try again shortly.');
    }
  }
}

module.exports = { loadCountyInventory };
