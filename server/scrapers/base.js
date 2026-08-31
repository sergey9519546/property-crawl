class BaseScraper {
  constructor({ name, sourceKey, timeoutMs = 15000, maxRetries = 3 } = {}) {
    this.name = name;
    this.sourceKey = sourceKey;
    this.timeoutMs = timeoutMs;
    this.maxRetries = maxRetries;
  }

  async executeWithRetry(fn) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        console.warn(`[${this.name}] Attempt ${attempt} failed: ${err.message}`);
        if (attempt < this.maxRetries) {
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }
    throw lastError;
  }

  standardizeListing(raw) {
    const openingBid = Number(raw.openingBid) || 50000;
    const estLow = Number(raw.estLow) || Math.round(openingBid * 1.35);
    const estHigh = Number(raw.estHigh) || Math.round(openingBid * 1.70);
    const mid = (estLow + estHigh) / 2;
    const ratio = openingBid / mid;
    const equity = Math.max(0, mid - openingBid);
    const dealScore = Math.max(1, Math.min(99, Math.round((1 - ratio) * 130)));

    return {
      id: raw.id || `${raw.state || 'US'}-${Date.now().toString(36).toUpperCase()}`,
      source: this.sourceKey,
      state: (raw.state || 'OH').toUpperCase(),
      county: raw.county || 'County',
      city: raw.city || 'City',
      zip: raw.zip || '00000',
      address: raw.address || `${raw.city}, ${raw.state}`,
      lat: Number(raw.lat) || 39.5,
      lng: Number(raw.lng) || -83.0,
      beds: Number(raw.beds) || 0,
      baths: Number(raw.baths) || 0,
      sqft: Number(raw.sqft) || 0,
      year: Number(raw.year) || null,
      propType: raw.propType || 'Single Family',
      openingBid,
      estLow,
      estHigh,
      assessed: Number(raw.assessed) || openingBid,
      mid,
      ratio,
      equity,
      dealScore,
      saleDate: raw.saleDate || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
      plaintiff: raw.plaintiff || '—',
      defendant: raw.defendant || '—',
      judgment: Number(raw.judgment) || openingBid,
      attorney: raw.attorney || '—',
      occupancy: raw.occupancy || 'Unknown',
      deposit: raw.deposit || '10% day of sale by certified funds',
      photo: raw.photo || 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=640&q=70',
      sourceUrl: raw.sourceUrl || null,
      raw: raw.raw || 'Scraped property record'
    };
  }
}

module.exports = BaseScraper;
