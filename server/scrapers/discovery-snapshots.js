'use strict';

/**
 * server/scrapers/discovery-snapshots.js
 *
 * Sanitized Markdown Evidence Snapshots (P1.9) and Discovery Snapshot Storage.
 * Generates human-auditable, script-sanitized Markdown documents from raw HTML dockets
 * and property cards, saving them alongside raw payload JSON for transparent provenance.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { createLedgerBlock, GENESIS_HASH, appendLedgerToFile, loadLedgerFromFile } = require('../discovery/evidence-ledger');

const DEFAULT_SNAPSHOT_DIR = path.resolve(__dirname, '../../.cache/discovery-snapshots');

function decodeHtmlEntities(text) {
  if (!text) return '';
  const named = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&nbsp;': ' ',
    '&pound;': '£',
    '&euro;': '€',
    '&copy;': '©',
    '&reg;': '®',
    '&trade;': '™',
    '&mdash;': '—',
    '&ndash;': '–'
  };
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|pound|euro|copy|reg|trade|mdash|ndash);/gi, (match) => named[match.toLowerCase()] || match)
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) && code > 0 ? String.fromCharCode(code) : '';
    });
}

function cleanCellText(cellHtml) {
  if (!cellHtml) return '';
  let text = cellHtml.replace(/<[^>]+>/g, ' ');
  text = decodeHtmlEntities(text);
  text = text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  return text;
}

function convertHtmlTables(html) {
  if (!html) return '';
  return html.replace(/<table\b[^>]*>([\s\S]*?)<\/table>/gi, (_, tableBody) => {
    const rowMatches = tableBody.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi);
    if (!rowMatches || rowMatches.length === 0) return '';

    const parsedRows = [];
    let isAllTwoCellKeyVal = true;

    for (const rowHtml of rowMatches) {
      const cellMatches = [...rowHtml.matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)];
      if (cellMatches.length === 0) continue;

      const cells = cellMatches.map((m) => ({
        tag: m[1].toLowerCase(),
        text: cleanCellText(m[2])
      }));

      if (cells.length !== 2 || cells[0].tag !== 'th' || cells[1].tag !== 'td') {
        isAllTwoCellKeyVal = false;
      }

      parsedRows.push(cells);
    }

    if (parsedRows.length === 0) return '';

    // Docket key-value pattern (every row has <th>Field</th><td>Value</td>)
    if (isAllTwoCellKeyVal && parsedRows.length >= 1) {
      const headerLine = '| Field | Value |';
      const sepLine = '| --- | --- |';
      const rowLines = parsedRows.map((r) => `| ${r[0].text} | ${r[1].text} |`);
      return `\n\n${headerLine}\n${sepLine}\n${rowLines.join('\n')}\n\n`;
    }

    let headerCells = [];
    let dataRows = [];

    if (parsedRows[0].some((c) => c.tag === 'th')) {
      headerCells = parsedRows[0].map((c) => c.text);
      dataRows = parsedRows.slice(1).map((r) => r.map((c) => c.text));
    } else {
      if (parsedRows.length > 1) {
        headerCells = parsedRows[0].map((c) => c.text);
        dataRows = parsedRows.slice(1).map((r) => r.map((c) => c.text));
      } else {
        headerCells = parsedRows[0].map((_, i) => `Column ${i + 1}`);
        dataRows = [parsedRows[0].map((c) => c.text)];
      }
    }

    const colCount = Math.max(headerCells.length, ...dataRows.map((r) => r.length), 1);
    while (headerCells.length < colCount) {
      headerCells.push(`Column ${headerCells.length + 1}`);
    }

    const formattedHeaders = `| ${headerCells.join(' | ')} |`;
    const formattedSep = `| ${headerCells.map(() => '---').join(' | ')} |`;
    const formattedData = dataRows.map((r) => {
      const padded = [...r];
      while (padded.length < colCount) padded.push('');
      return `| ${padded.join(' | ')} |`;
    });

    const tableParts = [formattedHeaders, formattedSep, ...formattedData].filter(Boolean);
    return `\n\n${tableParts.join('\n')}\n\n`;
  });
}

function convertHtmlToMarkdown(rawHtml) {
  if (typeof rawHtml !== 'string') return '';

  let text = rawHtml;

  // 1. Strip dangerous & executable blocks
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, '');
  text = text.replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, '');
  text = text.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, '');
  text = text.replace(/<object\b[^>]*>[\s\S]*?<\/object>/gi, '');
  text = text.replace(/<embed\b[^>]*>[\s\S]*?<\/embed>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');

  // Strip event handler attributes
  text = text.replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');

  // 2. Pre-process Tables
  text = convertHtmlTables(text);

  // 3. Headings
  text = text.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level, content) => {
    const headingText = cleanCellText(content);
    return `\n\n${'#'.repeat(Number(level))} ${headingText}\n\n`;
  });

  // 4. Definition lists
  text = text.replace(/<dt\b[^>]*>([\s\S]*?)<\/dt>/gi, (_, content) => {
    const dtText = cleanCellText(content).replace(/:$/, '');
    return `\n**${dtText}:** `;
  });
  text = text.replace(/<dd\b[^>]*>([\s\S]*?)<\/dd>/gi, (_, content) => {
    const ddText = cleanCellText(content);
    return `${ddText}\n`;
  });

  // 5. Lists
  text = text.replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_, listContent) => {
    const items = [...listContent.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    if (!items.length) return '';
    return '\n\n' + items.map((m) => `- ${cleanCellText(m[1])}`).join('\n') + '\n\n';
  });

  text = text.replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_, listContent) => {
    const items = [...listContent.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)];
    if (!items.length) return '';
    return '\n\n' + items.map((m, idx) => `${idx + 1}. ${cleanCellText(m[1])}`).join('\n') + '\n\n';
  });

  // 6. Block elements
  text = text.replace(/<hr\b[^>]*>/gi, '\n\n---\n\n');
  text = text.replace(/<br\b[^>]*\/?>/gi, '\n');
  text = text.replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_, content) => `\n\n${content}\n\n`);
  text = text.replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => `\n\n> ${cleanCellText(content)}\n\n`);

  // 7. Inline formatting
  text = text.replace(/<(?:strong|b)\b[^>]*>([\s\S]*?)<\/(?:strong|b)>/gi, (_, content) => {
    const inner = cleanCellText(content);
    return inner ? `**${inner}**` : '';
  });
  text = text.replace(/<(?:em|i)\b[^>]*>([\s\S]*?)<\/(?:em|i)>/gi, (_, content) => {
    const inner = cleanCellText(content);
    return inner ? `*${inner}*` : '';
  });
  text = text.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, (_, content) => {
    const inner = cleanCellText(content);
    return inner ? `\`${inner}\`` : '';
  });

  // Safe Links
  text = text.replace(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, content) => {
    const linkText = cleanCellText(content);
    const cleanHref = href.trim();
    if (/^(?:https?:\/\/|\/|#)/i.test(cleanHref)) {
      return `[${linkText}](${cleanHref})`;
    }
    return linkText;
  });

  // Badges / pills / status spans
  text = text.replace(/<span\b[^>]*class=["'][^"']*\b(?:badge|tag|label|status)\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, (_, content) => {
    const badgeText = cleanCellText(content);
    return badgeText ? ` [${badgeText}] ` : '';
  });

  // Block boundary dividers for container tags
  text = text.replace(/<\/(?:div|section|article|header|footer|aside)>/gi, '\n\n');
  text = text.replace(/<(?:div|section|article|header|footer|aside)\b[^>]*>/gi, '\n');

  // 8. Strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, ' ');

  // 9. Decode HTML entities
  text = decodeHtmlEntities(text);

  // 10. Normalize whitespace
  const lines = text.split('\n').map((line) => line.trim());
  let normalized = lines.join('\n');
  normalized = normalized.replace(/\n{3,}/g, '\n\n').trim();

  return normalized;
}

/**
 * Creates a sanitized, structured Markdown evidence document with auditable provenance metadata.
 *
 * @param {Object} options
 * @param {string} options.sourceKey - Scraper source key (e.g. 'civilview', 'hud', 'usda')
 * @param {string} options.recordId - Publisher record ID or case number
 * @param {string} options.html - Raw HTML content
 * @param {string} [options.title] - Human-readable evidence title
 * @param {Object} [options.metadata] - Extra metadata key/values
 * @returns {Object} Snapshot record with markdown text, sha256, and metadata
 */
function createMarkdownEvidenceSnapshot({
  sourceKey,
  recordId,
  html,
  title,
  metadata = {}
} = {}) {
  const safeSource = String(sourceKey || 'unknown').trim().toLowerCase();
  const safeRecordId = String(recordId || 'unknown').trim();
  const safeTitle = title || `${safeSource.toUpperCase()} Evidence Snapshot: ${safeRecordId}`;
  const capturedAt = metadata?.capturedAt || metadata?.observedAt || new Date().toISOString();

  const bodyMarkdown = convertHtmlToMarkdown(html);
  const rawSha256 = crypto.createHash('sha256').update(String(html || '')).digest('hex');

  const metaLines = [
    `# ${safeTitle}\n`,
    `- **Source:** ${safeSource}`,
    `- **Record ID:** ${safeRecordId}`,
    `- **Captured At:** ${capturedAt}`,
    `- **Raw Payload SHA256:** \`${rawSha256}\``,
  ];

  if (metadata && typeof metadata === 'object') {
    const excludedKeys = new Set(['capturedat', 'observedat', 'rawsha256', 'payloadsha256']);
    for (const [key, val] of Object.entries(metadata)) {
      if (excludedKeys.has(key.toLowerCase())) continue;
      if (val != null && typeof val !== 'object') {
        metaLines.push(`- **${key}:** ${val}`);
      }
    }
  }

  const markdown = `${metaLines.join('\n')}\n\n---\n\n${bodyMarkdown}`.trim() + '\n';
  const sha256 = crypto.createHash('sha256').update(markdown).digest('hex');

  const ledgerBlock = createLedgerBlock({
    index: Number(metadata?.ledgerIndex ?? 0),
    prevHash: metadata?.prevHash || GENESIS_HASH,
    timestamp: capturedAt,
    source: safeSource,
    recordId: safeRecordId,
    payloadSha256: rawSha256,
    action: 'MARKDOWN_SNAPSHOT_CREATED',
    metadata: {
      title: safeTitle,
      snapshotSha256: sha256
    }
  });

  return {
    sourceKey: safeSource,
    recordId: safeRecordId,
    title: safeTitle,
    markdown,
    sha256,
    capturedAt,
    metadata,
    ledgerBlock,
    toString() {
      return this.markdown;
    },
    includes(search, pos) {
      return this.markdown.includes(search, pos);
    }
  };
}

/**
 * Records an immutable discovery snapshot to disk (.cache/discovery-snapshots)
 * and optionally generates and saves a sanitized Markdown evidence file.
 *
 * @param {Object} input - Snapshot inputs
 * @param {Object} [options] - Options (snapshotDir, saveMarkdown, etc.)
 */
async function recordSnapshot(input = {}, options = {}) {
  const sourceKey = String(input.sourceKey || options.sourceKey || 'unknown').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(sourceKey)) throw new Error('Invalid snapshot source key');
  const recordId = String(input.recordId || input.sourceRecordId || options.recordId || '').trim();
  if (!recordId) throw new Error('Snapshot record ID required');
  const observedAt = input.observedAt || options.observedAt || new Date().toISOString();
  if (!Number.isFinite(Date.parse(observedAt))) throw new Error('Invalid snapshot observation date');
  const snapshotDir = options.snapshotDir || input.snapshotDir || process.env.PROPERTY_EVIDENCE_DIR || DEFAULT_SNAPSHOT_DIR;
  const storage = require('../discovery/evidence-storage').evidenceStorageStatus({evidenceDir:snapshotDir});
  if (storage.writesBlocked) throw new Error(storage.reason);
  const rawPayload = input.rawPayload !== undefined ? input.rawPayload : (input.raw ?? input.html ?? null);
  const html = typeof input.html === 'string' ? input.html : (typeof rawPayload === 'string' ? rawPayload : '');
  const payloadSha256 = crypto.createHash('sha256').update(typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload ?? null)).digest('hex');
  const rawRecord = {sourceKey,recordId,observedAt,payloadSha256,provenance:input.provenance || options.provenance || {},rawPayload,metadata:input.metadata || options.metadata || {}};
  const rawText = JSON.stringify(rawRecord, null, 2);
  const rawFileSha256 = crypto.createHash('sha256').update(rawText).digest('hex');
  const sourceDir = path.join(snapshotDir, sourceKey);
  fs.mkdirSync(sourceDir, {recursive:true});
  const rawPath = path.join(sourceDir, `${rawFileSha256}.json`);
  const writeImmutable = (target, text) => {
    try { const fd=fs.openSync(target,'wx',0o600); try { fs.writeFileSync(fd,text,'utf8'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
    catch (error) { if (error.code !== 'EEXIST') throw error; if (fs.readFileSync(target,'utf8') !== text) throw new Error('Snapshot content collision'); }
  };
  writeImmutable(rawPath,rawText);
  let markdownSnapshot = null, markdownPath = null;
  if (Boolean(input.saveMarkdown ?? options.saveMarkdown) && html) {
    markdownSnapshot = createMarkdownEvidenceSnapshot({sourceKey,recordId,html,title:input.title || options.title,metadata:{...rawRecord.metadata,observedAt,payloadSha256}});
    markdownPath = path.join(sourceDir,`${rawFileSha256}-${markdownSnapshot.sha256}.md`);
    writeImmutable(markdownPath,markdownSnapshot.markdown);
  }
  let reviewIntakeId = null;
  const confidence = Number(rawRecord.metadata.confidenceScore);
  if (rawRecord.metadata.reviewRequired === true || (rawRecord.metadata.confidenceScore != null && Number.isFinite(confidence) && confidence < 0.8)) {
    const sourceUrl = rawRecord.provenance.sourceUrl || rawRecord.metadata.sourceUrl;
    if (!sourceUrl) throw new Error('Review staging requires a publisher URL');
    const {submitEvidence} = require('../sources/intake');
    const staged = submitEvidence({sourceId:sourceKey,sourceUrl,capturedAt:observedAt,kind:'json',records:[{recordId,rawPayload,payloadSha256}],notes:'Extraction requires operator review; no listing promotion implied.'},{storePath:options.intakeStorePath});
    reviewIntakeId = staged.id || staged.record?.id || staged.summary?.id || null;
  }
  const ledgerBlock = await appendLedgerToFile(path.join(snapshotDir,'evidence-ledger.jsonl'),{source:sourceKey,recordId,payloadSha256,metadata:{observedAt,rawFile:path.basename(rawPath),rawFileSha256,markdownFile:markdownPath ? path.basename(markdownPath) : null,markdownSha256:markdownSnapshot?.sha256 || null,reviewIntakeId}});
  if (markdownSnapshot) markdownSnapshot.ledgerBlock = ledgerBlock;
  return {saved:true,sourceKey,recordId,rawPath,markdownPath,markdownSnapshot,markdown:markdownSnapshot?.markdown || null,ledgerBlock,payloadSha256,observedAt,reviewIntakeId};
}

function readSnapshot({sourceKey,recordId,snapshotDir = process.env.PROPERTY_EVIDENCE_DIR || DEFAULT_SNAPSHOT_DIR,entryHash} = {}) {
  const safeSource = String(sourceKey || '').trim().toLowerCase();
  if (!/^[a-z0-9-]+$/.test(safeSource)) throw new Error('Invalid snapshot source key');
  const chain = loadLedgerFromFile(path.join(snapshotDir,'evidence-ledger.jsonl'));
  const latest = chain.filter(entry=>entry.source===safeSource && entry.recordId===String(recordId) && (!entryHash || entry.entryHash===entryHash)).at(-1);
  if (!latest) return {raw:null,markdown:null,rawPath:null,markdownPath:null,ledgerBlock:null};
  const rawPath = path.join(snapshotDir,safeSource,path.basename(latest.metadata.rawFile));
  const rawText = fs.readFileSync(rawPath,'utf8');
  if (crypto.createHash('sha256').update(rawText).digest('hex') !== latest.metadata.rawFileSha256) throw new Error('Evidence snapshot hash mismatch');
  const raw = JSON.parse(rawText);
  let markdown = null, markdownPath = null;
  if (latest.metadata.markdownFile) {
    markdownPath=path.join(snapshotDir,safeSource,path.basename(latest.metadata.markdownFile));
    markdown=fs.readFileSync(markdownPath,'utf8');
    if (crypto.createHash('sha256').update(markdown).digest('hex') !== latest.metadata.markdownSha256) throw new Error('Markdown evidence hash mismatch');
  }
  return {raw,markdown,rawPath,markdownPath,ledgerBlock:latest};
}

function verifiedSnapshotReceipt(listing, options = {}) {
  const ref = listing?.provenance?.evidenceLedger;
  if (!ref?.entryHash) return null;
  try {
    const snapshot = readSnapshot({sourceKey:listing.source,recordId:listing.provenance.recordId,entryHash:ref.entryHash,...options});
    const block = snapshot.ledgerBlock;
    return block ? {index:block.index,entryHash:block.entryHash,payloadSha256:block.payloadSha256,observedAt:snapshot.raw.observedAt,verification:'local_chain_and_snapshot',externalAnchor:false} : null;
  } catch { return null; }
}

function evidenceStoreHealth(snapshotDir = process.env.PROPERTY_EVIDENCE_DIR || DEFAULT_SNAPSHOT_DIR) {
  const target = path.join(snapshotDir,'evidence-ledger.jsonl');
  const base = {backend:'file',...require('../discovery/evidence-storage').evidenceStorageStatus({evidenceDir:snapshotDir}),externalAnchor:false};
  if (!fs.existsSync(target)) return {...base,integrity:'not_recorded',entries:0};
  try { const chain=loadLedgerFromFile(target); return {...base,integrity:'chain_verified',entries:chain.length}; }
  catch { return {...base,integrity:'unreadable',writesBlocked:true,reason:'Evidence ledger is unreadable; original retained and writes refused'}; }
}

module.exports = {
  DEFAULT_SNAPSHOT_DIR,
  convertHtmlToMarkdown,
  createMarkdownEvidenceSnapshot,
  recordSnapshot,
  verifiedSnapshotReceipt,
  evidenceStoreHealth,
  readSnapshot,
  decodeHtmlEntities,
  convertHtmlTables,
  cleanCellText
};
