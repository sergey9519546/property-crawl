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
const { listHunts, evaluateInventory } = require('../intelligence/hunts');
const { sendHuntDigest } = require('./resend-client');

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
    : (typeof baselineRecord.clauseResults?.openingBid?.value === 'number'
        ? baselineRecord.clauseResults.openingBid.value
        : null);

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
function generateInvestorDigestReport({ hunt, evaluation, listings = [], options = {} }) {
  const appUrl = (options.appUrl || process.env.NEXT_PUBLIC_APP_URL || 'https://perfectproperty.org').replace(/\/+$/, '');
  const evaluatedAt = evaluation?.evaluatedAt || new Date().toISOString();
  const huntName = hunt?.name || 'Institutional Watchlist';
  const huntId = hunt?.id || 'HUNT-DEFAULT';

  // Identify matching listings from evaluation response
  const listingMap = new Map(listings.map((l) => [l.id, l]));
  const matchedRecords = (evaluation?.results || []).filter((r) => r.status === 'match');
  const matchedListings = [];
  const priceDrops = [];

  for (const record of matchedRecords) {
    const listing = listingMap.get(record.listingId) || {
      id: record.listingId,
      address: record.address,
      sourceUrl: record.sourceUrl,
    };
    matchedListings.push(listing);

    // Check for price drop if prior baseline record exists
    const prior = evaluation?.baseline?.records?.[record.identityKey];
    if (prior) {
      const drop = evaluatePriceDrop(listing, prior);
      if (drop) priceDrops.push(drop);
    }
  }

  // Format Markdown report
  const markdownLines = [
    `# Institutional Deal Alert Digest: ${huntName}`,
    `**Evaluation Timestamp:** ${evaluatedAt} | **Hunt ID:** \`${huntId}\` | **Total New Matches:** ${matchedListings.length}`,
    '',
    '## Target Matches Summary',
    '| Property Address | Jurisdiction | Opening Amount | Triage Score | Auction Date | Opportunity Link |',
    '|---|---|---|---|---|---|',
  ];

  for (const item of matchedListings) {
    const loc = [item.county ? `${item.county} Co.` : '', item.city, item.state].filter(Boolean).join(', ') || 'N/A';
    const bid = formatCurrency(item.openingBid);
    const score = item.dealScore != null ? `${item.dealScore}/99` : 'Unrated';
    const date = item.saleDate || item.auctionDate || 'Scheduled date pending';
    const link = `[View Dossier](${appUrl}/listings/${encodeURIComponent(String(item.id))})`;
    markdownLines.push(`| ${item.address || 'Address Unspecified'} | ${loc} | ${bid} | ${score} | ${date} | ${link} |`);
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
    const score = item.dealScore != null ? Number(item.dealScore) : null;
    const badge = score !== null ? `${score}/99` : '—';
    const scoreColor = score && score >= 80 ? '#059669' : score && score >= 65 ? '#2563eb' : '#d97706';
    const bid = formatCurrency(item.openingBid);
    const link = `${appUrl}/listings/${encodeURIComponent(String(item.id))}`;
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
      <div style="margin-top:4px;font-size:12px;color:#94a3b8;">Evaluated ${new Date(evaluatedAt).toLocaleString('en-US', { timeZone: 'America/New_York' })} EST</div>
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

  const deliveryResult = await sendHuntDigest({
    to: recipient,
    huntName: hunt.name,
    matches: report.matchedListings,
    subject: `[PropertyCrawl] Deal Alert Digest: ${hunt.name || 'Target Watchlist'}`,
    html: report.html,
    text: report.text || report.markdown,
    ...options,
  });

  return {
    delivered: deliveryResult.delivered,
    id: deliveryResult.id || null,
    reason: deliveryResult.reason || null,
    report,
  };
}

/**
 * Evaluates all hunts in store against the provided inventory and dispatches digests.
 */
async function runAllHuntDigests({ listings = [], options = {} }) {
  const hunts = listHunts({}, options);
  const results = [];
  let totalMatches = 0;
  let totalPriceDrops = 0;
  let digestsDispatched = 0;

  for (const hunt of hunts) {
    try {
      const evaluation = evaluateInventory(hunt, listings, options);
      const evalPayload = { ...evaluation.response, baseline: evaluation.baseline };
      const report = generateInvestorDigestReport({ hunt, evaluation: evalPayload, listings, options });

      totalMatches += report.matchedCount;
      totalPriceDrops += report.priceDropsCount;

      let dispatchResult = null;
      if (options.recipientEmail) {
        dispatchResult = await dispatchInvestorAlertDigest({
          recipient: options.recipientEmail,
          hunt,
          evaluation: evalPayload,
          listings,
          options,
        });
        if (dispatchResult.delivered) digestsDispatched++;
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

  return {
    evaluatedAt: new Date().toISOString(),
    totalHunts: hunts.length,
    totalMatches,
    totalPriceDrops,
    digestsDispatched,
    results,
  };
}

module.exports = {
  formatCurrency,
  evaluatePriceDrop,
  generateInvestorDigestReport,
  dispatchInvestorAlertDigest,
  runAllHuntDigests,
};
