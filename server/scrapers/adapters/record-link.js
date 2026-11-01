'use strict';
const {inspectSourceRecordUrl} = require('../source-policy');
function capturedRecordUrl(html, baseUrl) {
  for (const match of String(html || '').matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)) {
    try {
      const url = new URL(match[1].replace(/&amp;/g,'&'),baseUrl);
      if (url.hostname !== new URL(baseUrl).hostname) continue;
      if (inspectSourceRecordUrl('trustee',url.href).isValid) return url.href;
    } catch { /* An unsupported link is not exact record evidence. */ }
  }
  return null;
}
module.exports = {capturedRecordUrl};
