'use strict';

/**
 * Resend Outbound Webhook & Transactional Email Dispatcher.
 * Dispatches deal alerts and hunt digests via Resend HTTP API.
 * Fails closed cleanly when RESEND_API_KEY is unset or invalid.
 */

const RESEND_API_URL = 'https://api.resend.com/emails';
const DEFAULT_FROM = 'PerfectProperty Alerts <alerts@perfectproperty.org>';
const DEFAULT_BASE_URL = 'https://perfectproperty.org';

function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatCurrency(amount) {
  if (amount == null || amount === '') return 'Not published';
  const num = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(num)) return 'Not published';
  return `$${Math.round(num).toLocaleString('en-US')}`;
}

function scoreColor(score) {
  const num = Number(score);
  if (!Number.isFinite(num)) return '#64748b';
  if (num >= 80) return '#059669'; // Emerald
  if (num >= 65) return '#2563eb'; // Blue
  if (num >= 50) return '#d97706'; // Amber
  return '#dc2626'; // Red
}

function resolveConfig(options = {}) {
  const env = options.env || process.env;
  const apiKey = String(options.apiKey || env.RESEND_API_KEY || '').trim();
  const from = String(options.from || env.RESEND_FROM || DEFAULT_FROM).trim();
  const appUrl = String(options.appUrl || env.NEXT_PUBLIC_APP_URL || env.PUBLIC_APP_ORIGIN || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const fetchFn = options.fetchFn || (typeof fetch === 'function' ? fetch : null);
  return { apiKey, from, appUrl, fetchFn };
}

/**
 * Builds high-contrast HTML and plain text templates for a single deal alert.
 */
function buildDealAlertContent({ listing, matchReason, appUrl }) {
  const address = escapeHtml(listing.address || 'Property Address Not Published');
  const city = escapeHtml(listing.city || '');
  const state = escapeHtml(listing.state || '');
  const county = escapeHtml(listing.county || '');
  const location = [county ? `${county} County` : '', city, state].filter(Boolean).join(', ') || 'Location Unspecified';
  const dealScore = listing.dealScore != null ? Number(listing.dealScore) : null;
  const scoreBadge = dealScore !== null ? `${dealScore}/99` : 'Unrated';
  const badgeColor = scoreColor(dealScore);
  const openingBid = formatCurrency(listing.openingBid);
  const auctionDate = escapeHtml(listing.saleDate || listing.auctionDate || 'Scheduled date pending');
  const propType = escapeHtml(listing.propType || 'Distressed Asset');
  const reason = escapeHtml(matchReason || 'Matches your target underwriting threshold');
  const listingId = encodeURIComponent(String(listing.id || ''));
  const directLink = `${appUrl}/listings/${listingId}`;

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Deal Alert: ${address}</title>
</head>
<body style="margin:0;padding:24px 0;background-color:#090d16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <div style="max-width:600px;margin:0 auto;background-color:#0f172a;border:1px solid #1e293b;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);">
    <div style="padding:24px 28px;background:linear-gradient(180deg,#1e293b 0%,#0f172a 100%);border-bottom:1px solid #334155;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">PerfectProperty Intelligence Alert</div>
      <h1 style="margin:8px 0 0 0;font-size:20px;font-weight:700;color:#ffffff;line-height:1.3;">${address}</h1>
      <div style="margin-top:4px;font-size:13px;color:#94a3b8;">${location}</div>
    </div>
    <div style="padding:28px;">
      <div style="margin-bottom:24px;padding:12px 16px;background-color:#1e293b;border-left:4px solid ${badgeColor};border-radius:4px;">
        <span style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em;color:#94a3b8;">Match Trigger:</span>
        <div style="margin-top:2px;font-size:14px;color:#f1f5f9;font-weight:500;">${reason}</div>
      </div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:28px;">
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;">Deal Score</td>
          <td style="padding:12px 0;border-bottom:1px solid #1e293b;text-align:right;">
            <span style="display:inline-block;padding:4px 10px;background-color:${badgeColor};color:#ffffff;font-weight:700;font-size:13px;border-radius:6px;">${scoreBadge}</span>
          </td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;">Opening Bid</td>
          <td style="padding:12px 0;border-bottom:1px solid #1e293b;color:#38bdf8;font-size:15px;font-weight:700;text-align:right;">${openingBid}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;border-bottom:1px solid #1e293b;color:#94a3b8;font-size:13px;">Auction Date</td>
          <td style="padding:12px 0;border-bottom:1px solid #1e293b;color:#f1f5f9;font-size:13px;font-weight:500;text-align:right;">${auctionDate}</td>
        </tr>
        <tr>
          <td style="padding:12px 0;color:#94a3b8;font-size:13px;">Asset Type</td>
          <td style="padding:12px 0;color:#f1f5f9;font-size:13px;font-weight:500;text-align:right;">${propType}</td>
        </tr>
      </table>
      <div style="text-align:center;margin-top:16px;">
        <a href="${directLink}" style="display:inline-block;padding:14px 28px;background-color:#2563eb;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;border-radius:8px;box-shadow:0 4px 12px rgba(37,99,235,0.4);">View Full Opportunity Dossier &rarr;</a>
      </div>
    </div>
    <div style="padding:16px 28px;background-color:#090d16;border-top:1px solid #1e293b;font-size:11px;color:#64748b;text-align:center;">
      Automated intelligence dispatch. Evidence and docket records must be verified prior to bidding.
    </div>
  </div>
</body>
</html>`;

  const text = `PERFECTPROPERTY DEAL ALERT
----------------------------------------
Address:     ${listing.address || 'Address Not Published'}
Location:    ${location}
Deal Score:  ${scoreBadge}
Opening Bid: ${openingBid}
Auction:     ${listing.saleDate || listing.auctionDate || 'Scheduled date pending'}
Property:    ${listing.propType || 'Distressed Asset'}
Trigger:     ${matchReason || 'Target criteria matched'}

Access complete docket and title intelligence:
${directLink}
----------------------------------------
Automated intelligence dispatch. Verify official records before bidding.`;

  const subject = `[Deal Alert] ${listing.address || 'Distressed Property'} - Score: ${scoreBadge}`;
  return { subject, html, text };
}

/**
 * Builds HTML table and plain text templates for a hunt digest.
 */
function buildHuntDigestContent({ huntName, matches = [], appUrl }) {
  const safeHuntName = escapeHtml(huntName || 'Saved Hunt');
  const count = matches.length;

  const rowsHtml = matches.map((item) => {
    const addr = escapeHtml(item.address || 'Address Not Published');
    const loc = escapeHtml([item.county ? `${item.county} Co.` : '', item.state].filter(Boolean).join(', ') || 'N/A');
    const score = item.dealScore != null ? Number(item.dealScore) : null;
    const badge = score !== null ? `${score}/99` : '—';
    const color = scoreColor(score);
    const bid = formatCurrency(item.openingBid);
    const link = `${appUrl}/listings/${encodeURIComponent(String(item.id || ''))}`;
    return `<tr style="border-bottom:1px solid #1e293b;">
      <td style="padding:12px 8px;font-size:13px;color:#ffffff;font-weight:500;">
        <a href="${link}" style="color:#60a5fa;text-decoration:none;">${addr}</a>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${loc}</div>
      </td>
      <td style="padding:12px 8px;text-align:center;">
        <span style="display:inline-block;padding:2px 8px;background-color:${color};color:#ffffff;font-size:12px;font-weight:700;border-radius:4px;">${badge}</span>
      </td>
      <td style="padding:12px 8px;text-align:right;font-size:13px;color:#38bdf8;font-weight:600;">${bid}</td>
      <td style="padding:12px 8px;text-align:right;">
        <a href="${link}" style="display:inline-block;padding:6px 12px;background-color:#1e293b;border:1px solid #334155;color:#f8fafc;font-size:12px;text-decoration:none;border-radius:4px;font-weight:500;">View &rarr;</a>
      </td>
    </tr>`;
  }).join('\n');

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hunt Digest: ${safeHuntName}</title>
</head>
<body style="margin:0;padding:24px 0;background-color:#090d16;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <div style="max-width:680px;margin:0 auto;background-color:#0f172a;border:1px solid #1e293b;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px -5px rgba(0,0,0,0.5);">
    <div style="padding:24px 28px;background:linear-gradient(180deg,#1e293b 0%,#0f172a 100%);border-bottom:1px solid #334155;">
      <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#94a3b8;">Hunt Digest</div>
      <h1 style="margin:8px 0 0 0;font-size:20px;font-weight:700;color:#ffffff;">${count} New Match${count === 1 ? '' : 'es'} for "${safeHuntName}"</h1>
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
          ${rowsHtml}
        </tbody>
      </table>
    </div>
    <div style="padding:16px 28px;background-color:#090d16;border-top:1px solid #1e293b;font-size:11px;color:#64748b;text-align:center;">
      Digest dispatched automatically from PerfectProperty workspace hunts.
    </div>
  </div>
</body>
</html>`;

  const textLines = [
    `HUNT DIGEST: ${huntName || 'Saved Hunt'}`,
    `Found ${count} new matching properties:\n`,
    ...matches.map((m, i) => `${i + 1}. ${m.address || 'Unknown Address'} (${m.county ? m.county + ', ' : ''}${m.state || ''}) | Score: ${m.dealScore != null ? m.dealScore : 'N/A'} | Bid: ${formatCurrency(m.openingBid)}\n   Link: ${appUrl}/listings/${encodeURIComponent(String(m.id || ''))}`),
  ];

  const subject = `[Hunt Digest] ${count} New Match${count === 1 ? '' : 'es'} for "${huntName || 'Saved Hunt'}"`;
  return { subject, html, text: textLines.join('\n') };
}

/**
 * Dispatches an outbound email through Resend HTTP API.
 * Fails closed with { delivered: false, reason: 'RESEND_API_KEY_UNSET' } if key is missing.
 */
async function dispatchEmail({ to, from, subject, html, text, apiKey, fetchFn }) {
  if (!apiKey) {
    return { delivered: false, reason: 'RESEND_API_KEY_UNSET' };
  }

  if (!to || (typeof to !== 'string' && !Array.isArray(to))) {
    return { delivered: false, reason: 'INVALID_RECIPIENT' };
  }

  const recipients = Array.isArray(to) ? to : [to];
  if (recipients.length === 0 || recipients.some((r) => !r || typeof r !== 'string')) {
    return { delivered: false, reason: 'INVALID_RECIPIENT' };
  }

  if (typeof fetchFn !== 'function') {
    return { delivered: false, reason: 'FETCH_UNAVAILABLE', error: 'No fetch implementation provided or found in environment' };
  }

  try {
    const response = await fetchFn(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html,
        text,
      }),
    });

    if (!response.ok) {
      let errDetails = `HTTP ${response.status}`;
      try {
        const body = await response.json();
        errDetails = body.message || JSON.stringify(body);
      } catch {}
      return {
        delivered: false,
        reason: 'RESEND_API_ERROR',
        status: response.status,
        error: errDetails,
      };
    }

    const data = await response.json().catch(() => ({}));
    return {
      delivered: true,
      id: data.id || null,
      data,
    };
  } catch (error) {
    return {
      delivered: false,
      reason: 'NETWORK_ERROR',
      error: error?.message || String(error),
    };
  }
}

/**
 * Sends a single deal alert email.
 */
async function sendDealAlert(options = {}) {
  const { to, listing, matchReason } = options;
  const config = resolveConfig(options);

  if (!config.apiKey) {
    return { delivered: false, reason: 'RESEND_API_KEY_UNSET' };
  }

  if (!listing || typeof listing !== 'object') {
    return { delivered: false, reason: 'INVALID_LISTING' };
  }

  const { subject, html, text } = buildDealAlertContent({
    listing,
    matchReason,
    appUrl: config.appUrl,
  });

  return dispatchEmail({
    to,
    from: config.from,
    subject,
    html,
    text,
    apiKey: config.apiKey,
    fetchFn: config.fetchFn,
  });
}

/**
 * Sends a hunt digest email containing a summary table of matches.
 */
async function sendHuntDigest(options = {}) {
  const { to, huntName, matches } = options;
  const config = resolveConfig(options);

  if (!config.apiKey) {
    return { delivered: false, reason: 'RESEND_API_KEY_UNSET' };
  }

  if (!Array.isArray(matches)) {
    return { delivered: false, reason: 'INVALID_MATCHES' };
  }

  const { subject, html, text } = buildHuntDigestContent({
    huntName,
    matches,
    appUrl: config.appUrl,
  });

  return dispatchEmail({
    to,
    from: config.from,
    subject,
    html,
    text,
    apiKey: config.apiKey,
    fetchFn: config.fetchFn,
  });
}

class ResendClient {
  constructor(options = {}) {
    this.config = resolveConfig(options);
  }

  async sendDealAlert(options = {}) {
    return sendDealAlert({ ...this.config, ...options });
  }

  async sendHuntDigest(options = {}) {
    return sendHuntDigest({ ...this.config, ...options });
  }

  async sendEmail(options = {}) {
    const config = { ...this.config, ...options };
    return dispatchEmail({
      to: options.to,
      from: config.from,
      subject: options.subject,
      html: options.html,
      text: options.text,
      apiKey: config.apiKey,
      fetchFn: config.fetchFn,
    });
  }
}

module.exports = {
  sendDealAlert,
  sendHuntDigest,
  dispatchEmail,
  buildDealAlertContent,
  buildHuntDigestContent,
  ResendClient,
  RESEND_API_URL,
};
