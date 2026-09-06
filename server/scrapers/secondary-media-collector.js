'use strict';
const { ScraperCircuitBreaker } = require('./circuit-breaker');
const { crawlJitter } = require('./http');
const { exactAddress, propertyPage, extractSecondaryMedia } = require('./secondary-property-media');

class SecondaryMediaCollector {
  constructor({ fetchImpl = globalThis.fetch, sleep, maxPages = 4 } = {}) {
    this.fetch = fetchImpl; this.sleep = sleep;
    this.maxPages = Math.max(1, Math.min(6, maxPages));
    this.circuits = new Map();
  }

  async request(url, { search = false, redirects = 0 } = {}) {
    const host = new URL(url).hostname;
    if (!(search && host === 'www.bing.com') && !propertyPage(url)) throw new Error('Unsupported property page');
    let breaker = this.circuits.get(host);
    if (!breaker) { breaker = new ScraperCircuitBreaker(); this.circuits.set(host, breaker); }
    if (breaker.isOpen()) throw new Error('Provider circuit open');
    let response;
    try {
      response = await this.fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20_000), headers: { Accept: 'text/html,application/rss+xml', 'User-Agent': 'PerfectPropertyResearch/1.0' } });
    } catch {
      breaker.trip('Upstream transport failure');
      throw new Error('Upstream transport failure');
    }
    // Permit only trailing-slash canonicalization of the SAME property. A
    // redirect to another record, provider, login, or search is never evidence.
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      const target = location ? new URL(location, url).toString() : null;
      const currentPage = propertyPage(url), targetPage = propertyPage(target);
      await response.body?.cancel();
      if (!search && redirects < 1 && currentPage && targetPage && currentPage.url === targetPage.url) {
        await crawlJitter({ sleep: this.sleep });
        return this.request(target, { redirects: redirects + 1 });
      }
      breaker.trip('Redirect rejected');
      throw new Error('Property redirect requires a newly verified candidate');
    }
    if (response.status === 403) {
      breaker.validateResponse({ status: 403, body: '' });
      await response.body?.cancel();
      throw new Error('UPSTREAM_FORBIDDEN');
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error('Missing response body');
    const chunks = []; let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.length;
        if (bytes > 3_000_000) { breaker.trip('Property page exceeds size limit'); throw new Error('Property page exceeds size limit'); }
        chunks.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const html = Buffer.concat(chunks).toString('utf8');
    const validation = breaker.validateResponse({ status: response.status, body: html, headers: response.headers });
    if (!validation.isValid) throw new Error(validation.code || 'Provider response rejected');
    return html;
  }

  async discover(listing) {
    const address = exactAddress(listing);
    if (!address) return [];
    const query = `"${address.street}${address.unit ? ` UNIT ${address.unit}` : ''}" "${address.city}" "${address.state}" "${address.zip}" property photos`;
    const rss = await this.request(`https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, { search: true });
    const decode = text => text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
    return [...new Set([...rss.matchAll(/<link>([\s\S]*?)<\/link>/gi)].map(match => propertyPage(decode(match[1]))?.url).filter(Boolean))].slice(0, this.maxPages);
  }

  async collect(listing, candidates) {
    const report = { listingId: listing.id, attempts: [], accepted: false, reason: null };
    if (!exactAddress(listing)) return { ...report, reason: 'incomplete_canonical_address' };
    let urls;
    try { urls = candidates?.length ? candidates : await this.discover(listing); }
    catch { return { ...report, reason: 'search_unavailable' }; }
    for (const url of [...new Set(urls)].slice(0, this.maxPages)) {
      const page = propertyPage(url);
      if (!page) { report.attempts.push({ url, reason: 'unsupported_or_non_detail_page' }); continue; }
      await crawlJitter({ sleep: this.sleep });
      try {
        const result = extractSecondaryMedia({ listing, sourceUrl: page.url, html: await this.request(page.url) });
        report.attempts.push({ url: page.url, reason: result.accepted ? 'exact_address_gallery' : result.reason });
        if (result.accepted) return { ...report, accepted: true, media: result.media };
      } catch (error) { report.attempts.push({ url: page.url, reason: String(error.message).slice(0, 160) }); }
    }
    return { ...report, reason: urls.length ? 'no_qualified_gallery' : 'no_supported_candidates' };
  }
}
module.exports = { SecondaryMediaCollector };
