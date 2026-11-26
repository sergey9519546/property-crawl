'use strict';

/**
 * server/delivery/alert-digest.js
 * 
 * Track 5: Automated Alert Match Digest & Investor Notification Dispatcher.
 * Matches saved hunt criteria against newly ingested properties using server/intelligence/hunts.js.
 * Formats responsive Markdown/HTML email notifications and sends via server/delivery/resend-client.js.
 * Tracks price drops, statutory redemption windows, and second-look reconsideration triggers.
 * Strictly adheres to Zero-Fabrication Underwriting: unbenchmarked values remain explicit null.
 */

const crypto = require('node:crypto');
const { listHunts, evaluateInventory, sortHuntResults, MAX_RETURNED_RESULTS } = require('../intelligence/hunts');
const { loadStore, mutateStore, MAX_EVENTS } = require('../intelligence/hunt-store');
const { matchListingAgainstSearch } = require('../intelligence/saved-search-alerts');
const { detectPriceDrop } = require('../intelligence/price-drop-detector');
const { sendHuntDigest } = require('./resend-client');
const { isEmail, sendOutboundMail } = require('./outbound-mail');
const { getDurableCache, setDurableCache } = require('../enrichment/durable-cache');

const PRICE_DROP_CACHE_NAMESPACE = 'price_drop_digest';
const PRICE_DROP_CACHE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function resolvePriorOpeningBid(listing) {
  if (!listing || typeof listing !== 'object') return null;
  let best = null;
  for (const key of ['peakOpeningBid', 'initialOpeningBid', 'priorOpeningBid']) {
    const n = Number(listing[key]);
    if (Number.isFinite(n) && n > 0 && (best === null || n > best)) best = n;
  }
  return best;
}

function formatCurrency(amount) {
  if (amount == null || amount === '') return 'Not published';
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num)) return 'Not published';
  return `$${Math.round(num).toLocaleString('en-US')}`;
}

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Computes price drop between historical or baseline opening bids and current listing.
 */
function evaluatePriceDrop(listing, baselineRecord) {
  if (!listing || !baselineRecord) return null;
  const currentBid = typeof listing.openingBid === 'number' && Number.isFinite(listing.openingBid)
    ? listing.openingBid
    : null;
  const previousBid = typeof baselineRecord.openingBid === 'number' && Number.isFinite(baselineRecord.openingBid)
    ? baselineRecord.openingBid
    : (typeof baselineRecord.snapshot?.openingBid === 'number' && Number.isFinite(baselineRecord.snapshot.openingBid)
        ? baselineRecord.snapshot.openingBid
        : (typeof baselineRecord.clauseResults?.openingBid?.value === 'number'
            ? baselineRecord.clauseResults.openingBid.value
            : null));

  if (currentBid === null || previousBid === null) return null;
  if (currentBid < previousBid) {
    const dropAmount = previousBid - currentBid;
    const dropPct = Math.round((dropAmount / previousBid) * 1000) / 10;
    return {
      listingId: listing.id,
      address: listing.address,
      previousBid,
      currentBid,
      dropAmount,
      dropPct,
      reconsiderationTrigger: dropPct >= 10,
    };
  }
  return null;
}

/**
 * Generates an investor alert digest in both Markdown and HTML formats.
 */
const { getCanonicalOrigin } = require('../app-origin');

function generateInvestorDigestReport({ hunt, evaluation, listings = [], options = {} }) {
  const appUrl = getCanonicalOrigin(options.appUrl);
  const evaluatedAt = evaluation?.evaluatedAt || new Date().toISOString();
  const huntName = hunt?.name || 'Institutional Watchlist';
  const huntId = hunt?.id || 'HUNT-DEFAULT';

  // Identify matching listings from evaluation response
  const listingMap = new Map(listings.map((l) => [l.id, l]));
  const matchedRecords = (evaluation?.results || []).filter((r) => r.status === 'match');
  const matchedListings = [];
  const priceDrops = [];
  const dropByListingId = new Map();

  for (const record of matchedRecords) {
    const listing = listingMap.get(record.listingId) || {
      id: record.listingId,
      address: record.address,
      sourceUrl: record.sourceUrl,
    };
    matchedListings.push(listing);

    // Check for price drop if prior baseline record exists, or fall back to listing peak/initial/prior bid
    const prior = evaluation?.previousBaseline?.records?.[record.identityKey]
      || evaluation?.baseline?.records?.[record.identityKey];
    let drop = prior ? evaluatePriceDrop(listing, prior) : null;
    if (!drop) {
      const priorBid = resolvePriorOpeningBid(listing);
      if (priorBid !== null && Number(listing?.openingBid) > 0) {
        const detected = detectPriceDrop({ current: listing, previous: { openingBid: priorBid } });
        if (detected && detected.dropped) {
          const dropPct = Math.round(Math.abs(detected.deltaPct) * 1000) / 10;
          drop = {
            listingId: listing.id,
            address: listing.address,
            previousBid: detected.previousBid,
            currentBid: detected.currentBid,
            dropAmount: Math.abs(detected.delta),
            dropPct,
            reconsiderationTrigger: dropPct >= 10,
          };
        }
      }
    }
    if (drop) {
      priceDrops.push(drop);
      dropByListingId.set(listing.id, drop);
    }
  }

  // Format Markdown report
  const escapeMdCell = (val) => String(val ?? '').replace(/[\r\n]+/g, ' ').replace(/([|\\[\]])/g, '\\$1');
  const markdownLines = [
    `# Institutional Deal Alert Digest: ${escapeMdCell(huntName)}`,
    `**Evaluation Timestamp:** ${evaluatedAt} | **Hunt ID:** \`${huntId}\` | **Total New Matches:** ${matchedListings.length}`,
    '',
    '## Target Matches Summary',
    '| Property Address | Jurisdiction | Opening Amount | Triage Score | Auction Date | Opportunity Link |',
    '|---|---|---|---|---|---|',
  ];

  for (const item of matchedListings) {
    const loc = [item.county ? `${item.county} Co.` : '', item.city, item.state].filter(Boolean).join(', ') || 'N/A';
    const dropInfo = dropByListingId.get(item.id);
    const bid = dropInfo
      ? `${formatCurrency(item.openingBid)} (Down ${dropInfo.dropPct}% from ${formatCurrency(dropInfo.previousBid)})`
      : formatCurrency(item.openingBid);
    const score = item.dealScore != null ? `${item.dealScore}/99` : 'Unrated';
    const date = item.saleDate || item.auctionDate || 'Scheduled date pending';
    const link = `[View Dossier](${appUrl}/listings/${encodeURIComponent(String(item.id))})`;
    markdownLines.push(`| ${escapeMdCell(item.address || 'Address Unspecified')} | ${escapeMdCell(loc)} | ${escapeMdCell(bid)} | ${escapeMdCell(score)} | ${escapeMdCell(date)} | ${link} |`);
  }

  if (priceDrops.length > 0) {
    markdownLines.push('');
    markdownLines.push('## Price Drop & Reconsideration Triggers');
    for (const drop of priceDrops) {
      markdownLines.push(`- **${drop.address || drop.listingId}**: Opening bid lowered by **${drop.dropPct}%** (${formatCurrency(drop.previousBid)} → **${formatCurrency(drop.currentBid)}**).`);
    }
  }

  markdownLines.push('');
  markdownLines.push('> **Zero-Fabrication Underwriting Notice**: Triage Deal Scores and opening bid spreads do not constitute certified appraisals, title insurance guarantees, or bid authority. All senior liens, back taxes, and statutory redemption encumbrances must be verified against official dockets prior to auction entry.');

  const markdown = markdownLines.join('\n');

  // Format HTML Email Template
  const matchRowsHtml = matchedListings.map((item) => {
    const addr = escapeHtml(item.address || 'Address Not Published');
    const loc = escapeHtml([item.county ? `${item.county} Co.` : '', item.state].filter(Boolean).join(', ') || 'N/A');
    const rawScore = item.dealScore != null && item.dealScore !== '' ? Number(item.dealScore) : NaN;
    const score = Number.isFinite(rawScore) ? rawScore : null;
    const badge = score !== null ? `${score}/99` : '—';
    const scoreColor = score && score >= 80 ? '#059669' : score && score >= 65 ? '#2563eb' : '#d97706';
    const dropInfo = dropByListingId.get(item.id);
    const bid = dropInfo
      ? `${formatCurrency(item.openingBid)} <div style="font-size:11px;color:#38bdf8;font-weight:500;">Down ${dropInfo.dropPct}% from ${formatCurrency(dropInfo.previousBid)}</div>`
      : formatCurrency(item.openingBid);
    const link = escapeHtml(`${appUrl}/listings/${encodeURIComponent(String(item.id))}`);
    return `<tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:12px 8px;font-size:13px;color:#ffffff;font-weight:500;">
        <a href="${link}" style="color:#60a5fa;text-decoration:none;">${addr}</a>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${loc}</div>
      </td>
      <td style="padding:12px 8px;text-align:center;">
        <span style="display:inline-block;padding:2px 8px;background-color:${scoreColor};color:#ffffff;font-size:12px;font-weight:700;border-radius:4px;">${badge}</span>
      </td>
      <td style="padding:12px 8px;text-align:right;font-size:13px;color:#38bdf8;font-weight:600;">${bid}</td>
      <td style="padding:12px 8px;text-align:right;">
        <a href="${link}" style="display:inline-block;padding:6px 12px;background-color:#1e293b;border:1px solid #334155;color:#f8fafc;font-size:12px;text-decoration:none;border-radius:4px;font-weight:500;">View &rarr;</a>
      </td>
    </tr>`;
  }).join('\n');

  const priceDropSectionHtml = priceDrops.length > 0 ? `
    <div style="margin-top:24px;padding:16px;background-color:#1e293b;border-radius:8px;">
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;color:#38bdf8;letter-spacing:0.05em;margin-bottom:8px;">Opening Bid Price Drops Detected</div>
      ${priceDrops.map((d) => `
        <div style="font-size:13px;color:#f1f5f9;margin-bottom:6px;">
          <strong>${escapeHtml(d.address || d.listingId)}</strong>: Dropped <strong>${d.dropPct}%</strong> (${formatCurrency(d.previousBid)} &rarr; <span style="color:#38bdf8;font-weight:700;">${formatCurrency(d.currentBid)}</span>)
        </div>
      `).join('')}
    </div>
  ` : '';

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Alert Digest: ${escapeHtml(huntName)}</title>
</head>
<body style="margin:0;padding:24px 0;background-color:#090d16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <div style="max-width:680px;margin:0 auto;background-color:#0f172a;border:1px solid #1e293b;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);">
    <div style="padding:24px 28px;background:linear-gradient(180deg,#1e293b 0%,#0f172a 100%);border-bottom:1px solid #334155;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">PerfectProperty Hunt Digest</div>
      <h1 style="margin:8px 0 0 0;font-size:20px;font-weight:700;color:#ffffff;">${matchedListings.length} Matches for &quot;${escapeHtml(huntName)}&quot;</h1>
      <div style="margin-top:4px;font-size:12px;color:#94a3b8;">Evaluated ${new Date(evaluatedAt).toLocaleString('en-US', { timeZone: 'America/New_York', timeZoneName: 'short' })}</div>
    </div>
    <div style="padding:24px 20px;">
      <table style="width:100%;border-collapse:collapse;">
        <thead>
          <tr style="border-bottom:1px solid #334155;font-size:11px;text-transform:uppercase;color:#94a3b8;letter-spacing:0.05em;">
            <th style="padding:8px;text-align:left;">Property / Location</th>
            <th style="padding:8px;text-align:center;">Score</th>
            <th style="padding:8px;text-align:right;">Opening Bid</th>
            <th style="padding:8px;text-align:right;">Dossier</th>
          </tr>
        </thead>
        <tbody>
          ${matchRowsHtml || '<tr><td colspan="4" style="padding:20px;text-align:center;color:#94a3b8;">No new matching listings for this interval.</td></tr>'}
        </tbody>
      </table>
      ${priceDropSectionHtml}
    </div>
    <div style="padding:16px 28px;background-color:#090d16;border-top:1px solid #1e293b;font-size:11px;color:#64748b;text-align:center;">
      Zero-Fabrication Intelligence. Official docket and senior lien validation required before auction submission.
    </div>
  </div>
</body>
</html>`;

  return {
    huntId,
    huntName,
    evaluatedAt,
    matchedCount: matchedListings.length,
    priceDropsCount: priceDrops.length,
    matchedListings,
    priceDrops,
    markdown,
    html,
  };
}

/**
 * Dispatches an investor alert digest email via Resend if credentials are configured.
 */
async function dispatchInvestorAlertDigest({ recipient, hunt, evaluation, listings = [], options = {} }) {
  const report = generateInvestorDigestReport({ hunt, evaluation, listings, options });

  if (report.matchedCount === 0 && !options.forceDispatch) {
    return {
      delivered: false,
      reason: 'NO_NEW_MATCHES',
      report,
    };
  }

  const env = options.env || process.env;
  const apiKey = String(options.apiKey || env.RESEND_API_KEY || '').trim();
  if (!apiKey) {
    return {
      delivered: false,
      reason: 'RESEND_API_KEY_UNSET',
      dryRun: true,
      report,
    };
  }

  const safeSubjectName = String(hunt?.name || 'Target Watchlist').replace(/[\r\n]+/g, ' ').trim() || 'Target Watchlist';
  const deliveryResult = await sendHuntDigest({
    to: recipient,
    huntName: safeSubjectName,
    matches: report.matchedListings,
    subject: `[PerfectProperty] Deal Alert Digest: ${safeSubjectName}`,
    html: report.html,
    text: report.text || report.markdown,
    ...options,
    ...(options.fetchImpl && !options.fetchFn ? { fetchFn: options.fetchImpl } : {}),
  });

  return {
    delivered: deliveryResult.delivered,
    id: deliveryResult.id || null,
    reason: deliveryResult.reason || null,
    report,
  };
}

const CADENCE_WINDOW_MS = {
  instant: 0,
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

function isWithinCadenceCooldown(cadence, lastSentAt, nowMs) {
  const key = typeof cadence === 'string' ? cadence.trim().toLowerCase() : '';
  const windowMs = CADENCE_WINDOW_MS[key];
  if (!windowMs || !lastSentAt) return false;
  const lastMs = Date.parse(lastSentAt);
  return Number.isFinite(lastMs) && (nowMs - lastMs) < windowMs;
}

function resolveAccountId(owner) {
  if (typeof owner !== 'string' || !owner) return null;
  if (owner.startsWith('account:')) return owner.slice(8) || null;
  if (owner.startsWith('acct_')) return owner;
  return null;
}

/**
 * Evaluates verified county alert subscriptions (saved_searches with filters.notifyEmail
 * AND strict filters.verified === true) and dispatches investor digest emails.
 * Unverified subscriptions (filters.verified !== true) are strictly skipped.
 */
async function runCountyAlertDigests({ listings = [], options = {} } = {}) {
  const evaluatedAt = typeof options.now === 'string' ? options.now : new Date().toISOString();
  const nowMs = Date.parse(evaluatedAt) || Date.now();
  const database = options.database || null;
  const env = options.env || process.env;
  const accounts = options.accounts || (database ? require('../accounts/store').accountServiceFor(database, { env }) : null);

  if (
    !database
    || typeof database.listSavedSearchUserIds !== 'function'
    || typeof database.listSavedSearches !== 'function'
  ) {
    return {
      evaluatedAt,
      skipped: 'saved_searches_unavailable',
      totalSubscriptions: 0,
      verifiedSubscriptions: 0,
      skippedUnverified: 0,
      totalMatches: 0,
      digestsDispatched: 0,
      results: [],
    };
  }

  const userIds = await database.listSavedSearchUserIds();
  const results = [];
  let totalSubscriptions = 0;
  let verifiedSubscriptions = 0;
  let skippedUnverified = 0;
  let totalMatches = 0;
  let digestsDispatched = 0;

  for (const userId of Array.isArray(userIds) ? userIds : []) {
    const accountId = resolveAccountId(userId);
    let accountEntitled = true;
    if (accountId && accounts) {
      accountEntitled = Boolean((await accounts.get(accountId))?.entitled);
    }
    const searches = await database.listSavedSearches(userId, { includeInactive: false });
    for (const search of Array.isArray(searches) ? searches : []) {
      const recipient = typeof search?.filters?.notifyEmail === 'string'
        ? search.filters.notifyEmail.trim()
        : '';
      if (!recipient) continue;

      totalSubscriptions++;

      // Strict double-opt-in gate: never email any unverified subscription.
      if (search?.filters?.verified !== true) {
        skippedUnverified++;
        results.push({
          searchId: search?.id || null,
          userId,
          label: search?.label || null,
          skipped: true,
          reason: 'UNVERIFIED_SUBSCRIPTION',
          matchedCount: 0,
          dispatchResult: { delivered: false, reason: 'UNVERIFIED_SUBSCRIPTION' },
        });
        continue;
      }

      if (!accountEntitled) {
        results.push({
          searchId: search?.id || null,
          userId,
          label: search?.label || null,
          skipped: true,
          reason: 'ACCOUNT_NOT_ENTITLED',
          matchedCount: 0,
          dispatchResult: { delivered: false, reason: 'ACCOUNT_NOT_ENTITLED' },
        });
        continue;
      }

      const cadence = search?.filters?.cadence || 'daily';
      const lastSentAt = search?.filters?.lastSentAt || search?.lastSentAt || search?.lastRunAt || null;
      if (!options.forceDispatch && isWithinCadenceCooldown(cadence, lastSentAt, nowMs)) {
        results.push({
          searchId: search?.id || null,
          userId,
          label: search?.label || null,
          skipped: true,
          reason: 'CADENCE_COOLDOWN',
          matchedCount: 0,
          dispatchResult: { delivered: false, reason: 'CADENCE_COOLDOWN' },
        });
        continue;
      }

      verifiedSubscriptions++;

      try {
        const matchedListings = [];
        for (const listing of Array.isArray(listings) ? listings : []) {
          const verdict = matchListingAgainstSearch(listing, search);
          if (verdict.match) matchedListings.push(listing);
        }

        if (matchedListings.length === 0) {
          results.push({
            searchId: search.id,
            userId,
            label: search.label,
            matchedCount: 0,
            dispatchResult: { delivered: false, reason: 'NO_NEW_MATCHES' },
          });
          continue;
        }

        let targetListings = matchedListings;
        if (typeof database.recordAlertMatches === 'function') {
          const newRecords = await database.recordAlertMatches(
            userId,
            search.id,
            matchedListings.map((l) => l.id),
          );
          const newIds = new Set((Array.isArray(newRecords) ? newRecords : []).map((r) => r.listingId));
          const fresh = matchedListings.filter((l) => newIds.has(l.id));
          targetListings = fresh.length > 0 ? fresh : (options.forceDispatch ? matchedListings : []);
        }

        if (targetListings.length === 0) {
          results.push({
            searchId: search.id,
            userId,
            label: search.label,
            matchedCount: 0,
            dispatchResult: { delivered: false, reason: 'NO_NEW_CHANGES' },
          });
          continue;
        }

        totalMatches += targetListings.length;

        const evaluation = {
          evaluatedAt,
          results: targetListings.map((l) => ({
            identityKey: l.id,
            listingId: l.id,
            status: 'match',
          })),
        };

        const dispatchResult = await dispatchInvestorAlertDigest({
          recipient,
          hunt: {
            id: search.id,
            name: search.label || 'County Alert Digest',
            notifyEmail: recipient,
          },
          evaluation,
          listings: targetListings,
          options,
        });

        if (dispatchResult.delivered) {
          digestsDispatched++;
          if (typeof database.updateSavedSearch === 'function') {
            try {
              await database.updateSavedSearch(userId, search.id, {
                filters: { ...(search.filters || {}), lastSentAt: evaluatedAt },
              });
            } catch (_) {}
          }
        }

        results.push({
          searchId: search.id,
          userId,
          label: search.label,
          matchedCount: targetListings.length,
          dispatchResult,
        });
      } catch (err) {
        results.push({
          searchId: search?.id || null,
          userId,
          label: search?.label || null,
          error: err.message,
        });
      }
    }
  }

  return {
    evaluatedAt,
    totalSubscriptions,
    verifiedSubscriptions,
    skippedUnverified,
    totalMatches,
    digestsDispatched,
    results,
  };
}

/**
 * Evaluates all hunts in store against the provided inventory and dispatches digests.
 */
async function runAllHuntDigests({ listings = [], options = {} }) {
  const env = options.env || process.env;
  const nowIso = typeof options.now === 'string' ? options.now : new Date().toISOString();
  const nowMs = Date.parse(nowIso) || Date.now();
  const accounts = options.accounts || (options.database ? require('../accounts/store').accountServiceFor(options.database, { env }) : null);
  let durableStore = options.durableStore || null;
  if (!durableStore && options.database?.isPg && (options.database.pool?.query || typeof options.database.query === 'function')) {
    durableStore = require('../discovery/hunt-store').createPgHuntStore(options.database);
  }

  const fileStore = durableStore ? null : loadStore(options.filePath);
  const hunts = durableStore ? await durableStore.list() : listHunts(options);
  const results = [];
  let totalMatches = 0;
  let totalPriceDrops = 0;
  let digestsDispatched = 0;

  const evaluatePaged = (hunt, previousBaseline) => {
    const pageSize = 1000;
    const total = Array.isArray(listings) ? listings.length : 0;
    if (total <= pageSize) {
      return evaluateInventory(hunt, listings, {
        ...options,
        previousBaseline,
        baselineLimit: durableStore ? Infinity : options.baselineLimit,
      });
    }
    const initial = !previousBaseline || previousBaseline.huntVersion !== hunt.version;
    let evaluated = null;
    const events = [];
    let mergedResults = [];
    for (let offset = 0; offset < total; offset += pageSize) {
      const page = listings.slice(offset, offset + pageSize);
      evaluated = evaluateInventory(hunt, page, {
        ...options,
        previousBaseline: evaluated ? evaluated.baseline : previousBaseline,
        baselineLimit: Infinity,
        suppressEvents: initial,
      });
      events.push(...evaluated.events);
      mergedResults = sortHuntResults([...mergedResults, ...(evaluated.response.results || [])]).slice(0, MAX_RETURNED_RESULTS);
    }
    evaluated.events = events;
    evaluated.response = {
      ...evaluated.response,
      baselineCreated: initial,
      results: mergedResults,
    };
    return evaluated;
  };

  for (const hunt of hunts) {
    if (!hunt || !hunt.enabled) {
      results.push({
        huntId: hunt?.id || null,
        huntName: hunt?.name || null,
        skipped: true,
        reason: 'HUNT_DISABLED',
        matchedCount: 0,
        priceDropsCount: 0,
        dispatchResult: { delivered: false, reason: 'HUNT_DISABLED' },
      });
      continue;
    }

    const ownerAccountId = resolveAccountId(hunt.owner);
    if (ownerAccountId && accounts && !(await accounts.get(ownerAccountId))?.entitled) {
      results.push({
        huntId: hunt.id,
        huntName: hunt.name,
        skipped: true,
        reason: 'ACCOUNT_NOT_ENTITLED',
        matchedCount: 0,
        priceDropsCount: 0,
        dispatchResult: { delivered: false, reason: 'ACCOUNT_NOT_ENTITLED' },
      });
      continue;
    }

    if (!options.forceDispatch && isWithinCadenceCooldown(hunt.cadence, hunt.lastDigestAt || hunt.lastSentAt, nowMs)) {
      results.push({
        huntId: hunt.id,
        huntName: hunt.name,
        skipped: true,
        reason: 'CADENCE_COOLDOWN',
        matchedCount: 0,
        priceDropsCount: 0,
        dispatchResult: { delivered: false, reason: 'CADENCE_COOLDOWN' },
      });
      continue;
    }

    try {
      const previousBaseline = options.previousBaseline !== undefined
        ? options.previousBaseline
        : durableStore
          ? await durableStore.baseline(hunt.id)
          : (fileStore?.baselines?.[hunt.id] || null);

      const evaluation = evaluatePaged(hunt, previousBaseline);

      if (options.persistBaseline !== false) {
        if (durableStore && typeof durableStore.saveEvaluation === 'function') {
          await durableStore.saveEvaluation(hunt, evaluation);
        } else if (!durableStore) {
          mutateStore(options.filePath, (store) => {
            const target = store.hunts.find((item) => item.id === hunt.id);
            if (!target || Number(target.version) !== Number(hunt.version)) return { changed: false };
            store.baselines[hunt.id] = evaluation.baseline;
            const existing = new Set(store.events.map((event) => event.id));
            store.events = [
              ...(evaluation.events || []).filter((event) => !existing.has(event.id)),
              ...store.events,
            ]
              .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
              .slice(0, MAX_EVENTS);
            return { value: true };
          }, { now: evaluation.response.evaluatedAt });
        }
      }

      const evalPayload = {
        ...evaluation.response,
        baseline: evaluation.baseline,
        previousBaseline,
      };
      const report = generateInvestorDigestReport({ hunt, evaluation: evalPayload, listings, options });

      totalMatches += report.matchedCount;
      totalPriceDrops += report.priceDropsCount;

      const recipient = (typeof hunt.notifyEmail === 'string' && hunt.notifyEmail.trim())
        || (typeof options.recipientEmail === 'string' && options.recipientEmail.trim())
        || null;

      let dispatchResult = null;
      if (!recipient) {
        dispatchResult = { delivered: false, reason: 'NO_RECIPIENT', report };
      } else {
        const actionableEvents = (evaluation.events || []).filter(
          (event) => event && (event.type === 'new_match' || event.type === 'material_change'),
        );
        const hasActionableChanges = evaluation.response.baselineCreated
          || actionableEvents.length > 0
          || report.priceDropsCount > 0;

        if (!hasActionableChanges && !options.forceDispatch) {
          dispatchResult = { delivered: false, reason: 'NO_NEW_CHANGES', report };
        } else {
          const dispatchResultLocal = await dispatchInvestorAlertDigest({
            recipient,
            hunt,
            evaluation: evalPayload,
            listings,
            options,
          });
          dispatchResult = dispatchResultLocal;
          if (dispatchResult.delivered) digestsDispatched++;
        }
      }

      results.push({
        huntId: hunt.id,
        huntName: hunt.name,
        matchedCount: report.matchedCount,
        priceDropsCount: report.priceDropsCount,
        dispatchResult,
      });
    } catch (err) {
      results.push({
        huntId: hunt.id,
        huntName: hunt.name,
        error: err.message,
      });
    }
  }

  let countyAlerts = null;
  if (options.includeCountyAlerts !== false && options.database) {
    countyAlerts = await runCountyAlertDigests({ listings, options });
  }

  let watchlistPriceDrops = null;
  if (options.includeWatchlistPriceDrops !== false && options.database?.isPg && options.database?.pool) {
    try {
      watchlistPriceDrops = await runWatchlistPriceDropDigests(options.database, options);
    } catch (err) {
      watchlistPriceDrops = { error: err?.message || String(err), checked: 0, sent: 0 };
    }
  }

  return {
    evaluatedAt: new Date().toISOString(),
    totalHunts: hunts.length,
    totalMatches,
    totalPriceDrops,
    digestsDispatched,
    results,
    ...(countyAlerts ? { countyAlerts } : {}),
    ...(watchlistPriceDrops ? { watchlistPriceDrops } : {}),
  };
}

/**
 * Queries watched listings (saved_deals / alert_matches) where opening_bid > 0
 * and opening_bid < GREATEST(COALESCE(peak_opening_bid, 0), COALESCE(initial_opening_bid, 0)),
 * deduplicates per (userId, listingId, currentBid) in durable_kv_cache ('price_drop_digest', 90d TTL),
 * and sends verified email alerts matching alert-digest's verified-recipient rules.
 */
async function runWatchlistPriceDropDigests(database, options = {}) {
  const evaluatedAt = typeof options.now === 'string' ? options.now : new Date().toISOString();
  const env = options.env || process.env;
  if (!database?.pool || typeof database.pool.query !== 'function') {
    return {
      evaluatedAt,
      skipped: 'database_unavailable',
      checked: 0,
      sent: 0,
      deduplicated: 0,
      skippedUnverified: 0,
      results: [],
    };
  }

  const readCache = typeof options.getDurableCache === 'function' ? options.getDurableCache : getDurableCache;
  const writeCache = typeof options.setDurableCache === 'function' ? options.setDurableCache : setDurableCache;
  const baseUrl = getCanonicalOrigin(options.appUrl);

  const sql = `
    WITH watched AS (
      SELECT DISTINCT user_id, listing_id FROM saved_deals
      UNION
      SELECT DISTINCT user_id, listing_id FROM alert_matches
    ),
    verified_recipients AS (
      SELECT DISTINCT ON (user_id)
        user_id,
        COALESCE(NULLIF(TRIM(filters->>'notifyEmail'), ''), NULLIF(TRIM(filters->>'email'), '')) AS email
      FROM saved_searches
      WHERE is_active = TRUE
        AND COALESCE(filters->>'verified', 'false') = 'true'
        AND COALESCE(NULLIF(TRIM(filters->>'notifyEmail'), ''), NULLIF(TRIM(filters->>'email'), '')) IS NOT NULL
      ORDER BY user_id, updated_at DESC NULLS LAST, created_at DESC NULLS LAST
    )
    SELECT
      w.user_id AS "userId",
      vr.email AS "notifyEmail",
      l.id AS "listingId",
      l.address,
      l.city,
      l.state,
      l.opening_bid AS "openingBid",
      l.peak_opening_bid AS "peakOpeningBid",
      l.initial_opening_bid AS "initialOpeningBid",
      l.deal_score AS "dealScore",
      l.sale_date AS "saleDate"
    FROM watched w
    JOIN listings l ON l.id = w.listing_id
    LEFT JOIN verified_recipients vr ON vr.user_id = w.user_id
    WHERE l.opening_bid > 0
      AND l.opening_bid < GREATEST(COALESCE(l.peak_opening_bid, 0), COALESCE(l.initial_opening_bid, 0))
    ORDER BY w.user_id, l.id
    LIMIT 500
  `;

  const res = await database.pool.query(sql);
  const rows = Array.isArray(res?.rows) ? res.rows : [];
  const results = [];
  let checked = 0;
  let sent = 0;
  let deduplicated = 0;
  let skippedUnverified = 0;

  for (const row of rows) {
    checked++;
    const recipient = isEmail(row.notifyEmail);
    if (!recipient) {
      skippedUnverified++;
      results.push({
        userId: row.userId,
        listingId: row.listingId,
        skipped: true,
        reason: 'UNVERIFIED_RECIPIENT',
      });
      continue;
    }

    const priorBid = resolvePriorOpeningBid(row);
    if (priorBid === null || !(Number(row.openingBid) > 0)) continue;
    const drop = detectPriceDrop({
      current: { openingBid: row.openingBid },
      previous: { openingBid: priorBid },
    });
    if (!drop || !drop.dropped) continue;

    const dedupKey = `${row.userId}:${row.listingId}:${drop.currentBid}`;
    const alreadySent = await readCache(PRICE_DROP_CACHE_NAMESPACE, dedupKey, { db: database });
    if (alreadySent) {
      deduplicated++;
      results.push({
        userId: row.userId,
        listingId: row.listingId,
        deduplicated: true,
        currentBid: drop.currentBid,
      });
      continue;
    }

    const dropPct = Math.round(Math.abs(drop.deltaPct) * 1000) / 10;
    const addr = row.address || row.listingId;
    const location = [row.city, row.state].filter(Boolean).join(', ');
    const listingUrl = `${baseUrl}/listings/${encodeURIComponent(String(row.listingId))}`;
    const subject = `[PerfectProperty] Price Drop Alert: ${addr} (Down ${dropPct}%)`;
    const text = [
      `Price drop detected on your watched listing: ${addr}${location ? ` (${location})` : ''}`,
      `Opening bid dropped ${dropPct}% from ${formatCurrency(drop.previousBid)} to ${formatCurrency(drop.currentBid)}.`,
      row.saleDate ? `Sale Date: ${String(row.saleDate).slice(0, 10)}` : null,
      `View Dossier: ${listingUrl}`,
      '',
      'Zero-Fabrication Notice: Verify current docket status and senior liens prior to bidding.',
    ].filter((line) => line !== null).join('\n');

    const mailOpts = {
      ...(options.mailOptions || {}),
      env: options.mailOptions?.env || env,
      ...(options.fetchImpl && !options.mailOptions?.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    };
    const mail = await sendOutboundMail({
      to: recipient,
      subject,
      text,
      kind: 'price-drop-digest',
    }, mailOpts);

    if (mail.sent || mail.delivery === 'sent') {
      sent++;
      await writeCache(
        PRICE_DROP_CACHE_NAMESPACE,
        dedupKey,
        {
          sentAt: evaluatedAt,
          userId: row.userId,
          listingId: row.listingId,
          previousBid: drop.previousBid,
          currentBid: drop.currentBid,
          deltaPct: drop.deltaPct,
        },
        { db: database, ttlMs: PRICE_DROP_CACHE_TTL_MS },
      );
    }

    results.push({
      userId: row.userId,
      listingId: row.listingId,
      previousBid: drop.previousBid,
      currentBid: drop.currentBid,
      dropPct,
      mailDelivery: mail.delivery,
      sent: Boolean(mail.sent),
    });
  }

  return {
    evaluatedAt,
    checked,
    sent,
    deduplicated,
    skippedUnverified,
    results,
  };
}

module.exports = {
  formatCurrency,
  evaluatePriceDrop,
  generateInvestorDigestReport,
  dispatchInvestorAlertDigest,
  runCountyAlertDigests,
  runWatchlistPriceDropDigests,
  runAllHuntDigests,
};
