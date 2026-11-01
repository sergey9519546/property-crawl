'use strict';

const robotsParser = require('robots-parser');
const { getHarrisClerkSearchUrl, parseHarrisClerkHtml, cleanCellText } = require('./harris-clerk-foreclosure');
const PREFIX = 'ctl00$ContentPlaceHolder1$';
const USER_AGENT = 'property-crawl-bot/1.0';
const decode = value => String(value).replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

function formState(html) {
  const state = new URLSearchParams();
  for (const match of html.matchAll(/<input\b[^>]+>/gi)) {
    const attrs = Object.fromEntries([...match[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m => [m[1], decode(m[2])]));
    if (attrs.name && (attrs.type === 'hidden' || attrs.type === 'text' || (attrs.type === 'radio' && /checked=/i.test(match[0])))) state.set(attrs.name, attrs.value || '');
  }
  if (!state.has('__VIEWSTATE') || !state.has('__EVENTVALIDATION')) throw new Error('HARRIS_FORM_CHANGED: required form state is absent');
  return state;
}

function optionsFor(html, name) {
  const select = [...html.matchAll(/<select\b[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/select>/gi)].find(m => m[1] === PREFIX + name);
  return select ? [...select[2].matchAll(/<option\b[^>]*value="([^"]*)"/gi)].map(m => decode(m[1])) : [];
}

// Only published form controls are submitted. requestText must use the caller's
// circuit breaker/transport policy and preserve its per-query cookie session.
async function queryHarrisClerk({ requestText, year, month, maxPages = 1, baseUrl } = {}) {
  if (typeof requestText !== 'function') throw new Error('Harris query requires a policy-bound transport');
  if (!Number.isInteger(year) || year < 2013 || !Number.isInteger(month) || month < 1 || month > 12) throw new Error('Explicit Harris query year/month required');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 25) throw new Error('Harris page limit must be 1–25');
  const url = getHarrisClerkSearchUrl({ baseUrl });
  const robotsUrl = new URL('/robots.txt', url).href;
  const rules = await requestText(robotsUrl, { headers: { 'User-Agent': USER_AGENT } });
  if (robotsParser(robotsUrl, rules).isAllowed(url, USER_AGENT) === false) throw new Error('HARRIS_ROBOTS_DENIED');
  let html = await requestText(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!optionsFor(html, 'ddlYear').includes(String(year))) throw new Error('HARRIS_QUERY_YEAR_UNAVAILABLE');
  async function submit(state) {
    return requestText(url, { method: 'POST', headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded' }, body: state.toString() });
  }
  // The initial year can expose a different set of months. First request the
  // chosen year using the form's own Search button, then use its refreshed state.
  let state = formState(html);
  state.set(PREFIX + 'ddlYear', String(year));
  state.set(PREFIX + 'ddlMonth', 'Select -');
  state.set(PREFIX + 'btnSearch', 'Search');
  html = await submit(state);
  if (!optionsFor(html, 'ddlMonth').includes(String(month))) throw new Error('HARRIS_QUERY_MONTH_UNAVAILABLE');
  state = formState(html);
  state.set(PREFIX + 'ddlYear', String(year));
  state.set(PREFIX + 'ddlMonth', String(month));
  state.set(PREFIX + 'btnSearch', 'Search');
  html = await submit(state);
  const pages = [], records = [];
  let publishedTotal = null, hasMore = false;
  for (let page = 1; page <= maxPages; page++) {
    const count = html.match(/id="[^"]*lblCount"[^>]*>([\s\S]*?)<\/span>/i);
    const total = cleanCellText(count?.[1]).match(/^(\d[\d,]*) Row\(s\) Found\./i);
    if (!total) throw new Error('RECORDER_QUERY_UNVERIFIED: no authoritative Harris result count');
    publishedTotal = Number(total[1].replace(/,/g, ''));
    const parsed = parseHarrisClerkHtml(html, { baseUrl: url });
    if (publishedTotal > 0 && !parsed.length) throw new Error('HARRIS_RESULTS_CHANGED: published rows could not be parsed');
    pages.push({ html, page, url }); records.push(...parsed);
    const next = `Page$${page + 1}`;
    hasMore = decode(html).includes(`'${next}'`);
    if (!hasMore || page === maxPages) break;
    state = formState(html);
    state.set(PREFIX + 'ddlYear', String(year)); state.set(PREFIX + 'ddlMonth', String(month));
    state.set('__EVENTTARGET', PREFIX + 'GridView1'); state.set('__EVENTARGUMENT', next);
    html = await submit(state);
  }
  if (new Set(records.map(r => r.fileNumber)).size !== records.length) throw new Error('HARRIS_PAGINATION_REPEATED: query did not advance');
  return { records, pages, year, month, publishedTotal, collected: records.length, truncated: hasMore, complete: !hasMore && records.length === publishedTotal };
}

module.exports = { queryHarrisClerk, formState, optionsFor };
