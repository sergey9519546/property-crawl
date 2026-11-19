'use strict';

/**
 * server/storage/document-vault.js
 *
 * Persistent Document Vault Adapter:
 * Zero-cost, immutable archiving layer for evidentiary documents:
 * - PDF sheriff auction notices & legal filings
 * - OCR docket texts and property inspection sheets
 * - Underwriting decision packets & investor memos
 * - Panoramax street-level imagery
 *
 * Pluggable Storage Backends:
 * 1. Cloudflare R2 / AWS S3: Active when R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY are set.
 *    (Cloudflare R2 provides a 10 GB free tier with $0 egress fees).
 * 2. Local Filesystem: Default fallback writing to .cache/vault/ with atomic tempfile replacement.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { replaceFileWithRetry } = require('../intelligence/research-store');

const DEFAULT_VAULT_DIR = path.resolve(process.cwd(), '.cache/vault');
const MAX_KEY_LENGTH = 512;
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50 MB safety clamp
const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmacSha256(key, value) {
  return crypto.createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * Generates AWS Signature Version 4 headers for Cloudflare R2 / S3 REST calls.
 */
function createR2SignedHeaders({
  method,
  url,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  payloadSha256 = EMPTY_SHA256,
  headers = {},
  now = new Date(),
}) {
  const parsed = new URL(url);
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const service = 's3';
  const normalizedMethod = String(method || 'GET').toUpperCase();

  const signingMap = new Map();
  signingMap.set('host', parsed.host);
  signingMap.set('x-amz-content-sha256', payloadSha256);
  signingMap.set('x-amz-date', amzDate);

  const outputHeaders = {
    'x-amz-content-sha256': payloadSha256,
    'x-amz-date': amzDate,
  };
  for (const [k, v] of Object.entries(headers || {})) {
    if (v === undefined || v === null) continue;
    const strVal = String(v).trim().replace(/\s+/g, ' ');
    outputHeaders[k] = strVal;
    const lower = k.toLowerCase();
    if (lower !== 'content-length') {
      signingMap.set(lower, strVal);
    }
  }

  const sortedHeaderNames = [...signingMap.keys()].sort();
  const canonicalHeaders = sortedHeaderNames.map((k) => `${k}:${signingMap.get(k)}\n`).join('');
  const signedHeaders = sortedHeaderNames.join(';');

  const queryPairs = [];
  for (const [qk, qv] of parsed.searchParams.entries()) {
    queryPairs.push([encodeRfc3986(qk), encodeRfc3986(qv)]);
  }
  queryPairs.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const canonicalQuerystring = queryPairs.map(([k, v]) => `${k}=${v}`).join('&');

  const canonicalUri = parsed.pathname || '/';
  const canonicalRequest = [
    normalizedMethod,
    canonicalUri,
    canonicalQuerystring,
    canonicalHeaders,
    signedHeaders,
    payloadSha256,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  outputHeaders.Authorization = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return outputHeaders;
}

// Atomic file write: temp file -> fsync -> rename -> fsync directory.
// Keeps the target file whole: a crash during the write never leaves a
// truncated destination, and the caller can rely on the rename being durable.
function fsyncDir(dir) {
  try {
    const fd = fs.openSync(dir, 'r');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  } catch {} // best-effort; directory fsync may not be supported everywhere
}

function atomicWrite(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tempFile = `${filePath}.${crypto.randomUUID()}.tmp`;
  const fd = fs.openSync(tempFile, 'wx');
  try {
    try {
      fs.writeSync(fd, data);
      fs.fdatasyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    replaceFileWithRetry(tempFile, filePath);
    fsyncDir(dir);
  } finally {
    try { if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile); } catch {}
  }
}

function sanitizeKey(rawKey) {
  if (typeof rawKey !== 'string') throw new Error('Document key must be a string');
  const trimmed = rawKey.trim().replace(/^[\/\\]+/, '');
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) {
    throw new Error(`Document key must be between 1 and ${MAX_KEY_LENGTH} characters`);
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('Document key contains illegal path traversal or control characters');
  }
  const normalized = trimmed.replace(/\\/g, '/');
  const segments = normalized.split('/');
  if (segments.some((seg) => !seg || seg === '.' || seg === '..')) {
    throw new Error('Document key contains illegal path traversal or control characters');
  }
  return normalized;
}

function buildR2MetaHeaders(sha256, metadata = {}) {
  const headers = { 'x-amz-meta-sha256': sha256 };
  if (!metadata || typeof metadata !== 'object') return headers;
  for (const [rawKey, rawVal] of Object.entries(metadata)) {
    if (rawVal === undefined || rawVal === null) continue;
    const safeKey = String(rawKey)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/^-+|-+$/g, '');
    if (!safeKey || safeKey === 'sha256') continue;
    const formatted = typeof rawVal === 'string' ? rawVal : JSON.stringify(rawVal);
    const cleaned = formatted.replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').trim();
    if (cleaned) headers[`x-amz-meta-${safeKey}`] = cleaned;
  }
  return headers;
}

function extractR2Metadata(headers) {
  let sha256 = null;
  const metadata = {};
  if (!headers) return { sha256, metadata };
  const entries = typeof headers.entries === 'function'
    ? [...headers.entries()]
    : Object.entries(headers);
  for (const [k, v] of entries) {
    const lower = String(k).toLowerCase();
    if (lower === 'x-amz-meta-sha256') {
      const candidate = String(v).trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(candidate)) sha256 = candidate;
    } else if (lower.startsWith('x-amz-meta-')) {
      const metaKey = lower.slice('x-amz-meta-'.length);
      if (metaKey) metadata[metaKey] = String(v);
    }
  }
  return { sha256, metadata };
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseListObjectsV2Xml(xml) {
  const items = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match;
  while ((match = contentsRegex.exec(xml)) !== null) {
    const block = match[1];
    const keyMatch = block.match(/<Key>([\s\S]*?)<\/Key>/);
    if (!keyMatch) continue;
    const key = decodeXmlEntities(keyMatch[1]).trim();
    if (!key) continue;
    const sizeMatch = block.match(/<Size>(\d+)<\/Size>/);
    const modMatch = block.match(/<LastModified>([\s\S]*?)<\/LastModified>/);
    items.push({
      key,
      size: sizeMatch ? Number(sizeMatch[1]) : null,
      updatedAt: modMatch ? decodeXmlEntities(modMatch[1]).trim() : null,
      storageType: 'r2',
    });
  }
  const truncatedMatch = xml.match(/<IsTruncated>\s*(true|false)\s*<\/IsTruncated>/i);
  const nextTokenMatch = xml.match(/<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/);
  return {
    items,
    isTruncated: Boolean(truncatedMatch && truncatedMatch[1].toLowerCase() === 'true'),
    nextContinuationToken: nextTokenMatch ? decodeXmlEntities(nextTokenMatch[1]).trim() : null,
  };
}

class DocumentVault {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.vaultDir = options.vaultDir || this.env.PROPERTY_VAULT_DIR || ((this.env.VERCEL === '1' || this.env.NOW_REGION) ? path.join(require('node:os').tmpdir(), 'property-crawl-cache', 'vault') : DEFAULT_VAULT_DIR);
    this.requireDurable = options.requireDurable !== undefined
      ? Boolean(options.requireDurable)
      : (this.env.REQUIRE_DURABLE_VAULT === '1' || this.env.REQUIRE_DURABLE_VAULT === 'true');
    this.lastError = null;

    // R2 / S3 Configuration
    const r2Bucket = this.env.R2_BUCKET || this.env.AWS_S3_BUCKET || null;
    const r2AccessKey = this.env.R2_ACCESS_KEY_ID || this.env.AWS_ACCESS_KEY_ID || null;
    const r2SecretKey = this.env.R2_SECRET_ACCESS_KEY || this.env.AWS_SECRET_ACCESS_KEY || null;
    const r2AccountId = this.env.R2_ACCOUNT_ID || null;

    const r2Region = this.env.R2_REGION || this.env.AWS_REGION || 'auto';

    let r2Endpoint = this.env.R2_ENDPOINT || null;
    if (!r2Endpoint && r2AccountId) {
      r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;
    }
    if (r2Endpoint) {
      r2Endpoint = String(r2Endpoint).replace(/\/+$/, '');
    }

    this.r2Config = {
      isConfigured: Boolean(r2Bucket && r2AccessKey && r2SecretKey),
      bucket: r2Bucket,
      accessKeyId: r2AccessKey,
      secretAccessKey: r2SecretKey,
      endpoint: r2Endpoint,
      region: r2Region,
    };

    this.fetchImpl = options.fetchImpl || fetch;
  }

  get storageType() {
    return this.r2Config.isConfigured ? 'r2' : 'local';
  }

  _assertDurableReady() {
    if (this.requireDurable && (!this.r2Config.isConfigured || !this.r2Config.endpoint)) {
      this.lastError = 'Durable vault (REQUIRE_DURABLE_VAULT=1) requires R2/S3 credentials and endpoint';
      throw new Error(this.lastError);
    }
  }

  _r2ListUrl({ prefix = '', maxKeys = 1000, continuationToken = null } = {}) {
    const url = new URL(`${this.r2Config.endpoint}/${encodeRfc3986(this.r2Config.bucket)}`);
    url.searchParams.set('list-type', '2');
    if (prefix) url.searchParams.set('prefix', prefix);
    url.searchParams.set('max-keys', String(maxKeys));
    if (continuationToken) url.searchParams.set('continuation-token', continuationToken);
    return url.toString();
  }

  async _fetchR2Url(method, remoteUrl, { body, payloadSha256 = EMPTY_SHA256, headers = {}, now } = {}) {
    if (!this.r2Config.isConfigured || !this.r2Config.endpoint) return null;
    const signedHeaders = createR2SignedHeaders({
      method,
      url: remoteUrl,
      accessKeyId: this.r2Config.accessKeyId,
      secretAccessKey: this.r2Config.secretAccessKey,
      region: this.r2Config.region,
      payloadSha256,
      headers,
      now,
    });
    return this.fetchImpl(remoteUrl, {
      method,
      headers: signedHeaders,
      ...(body !== undefined ? { body } : {}),
    });
  }

  _r2ObjectUrl(key) {
    const encodedPath = [this.r2Config.bucket, ...key.split('/')].map(encodeRfc3986).join('/');
    return `${this.r2Config.endpoint}/${encodedPath}`;
  }

  async _fetchR2(method, key, { body, payloadSha256 = EMPTY_SHA256, headers = {}, now } = {}) {
    if (!this.r2Config.isConfigured || !this.r2Config.endpoint) return null;
    const remoteUrl = this._r2ObjectUrl(key);
    const signedHeaders = createR2SignedHeaders({
      method,
      url: remoteUrl,
      accessKeyId: this.r2Config.accessKeyId,
      secretAccessKey: this.r2Config.secretAccessKey,
      region: this.r2Config.region,
      payloadSha256,
      headers,
      now,
    });
    return this.fetchImpl(remoteUrl, {
      method,
      headers: signedHeaders,
      ...(body !== undefined ? { body } : {}),
    });
  }

  _localFilePath(key) {
    const cleanKey = sanitizeKey(key);
    return path.join(this.vaultDir, ...cleanKey.split('/'));
  }

  /**
   * Stores a document in the vault.
   *
   * @param {string} rawKey - Target storage key
   * @param {Buffer|string} data - Content to store
   * @param {Object} [options={}] - { contentType, metadata }
   * @returns {Promise<Object>} storage receipt
   */
  async putDocument(rawKey, data, options = {}) {
    this._assertDurableReady();
    const key = sanitizeKey(rawKey);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');

    if (buffer.length > MAX_DOCUMENT_SIZE) {
      throw new Error(`Document exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`);
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentType = options.contentType || 'application/octet-stream';
    const storedAt = new Date().toISOString();

    // 1. Always store locally as fast local cache / durable backup.
    //    Payload is committed first so a crash can never leave meta without
    //    payload; meta is written second and degraded gracefully if absent.
    const localPath = this._localFilePath(key);
    atomicWrite(localPath, buffer);

    // Write sidecar metadata atomically. The vault tolerates a missing meta
    // file on read (recomputes sha from payload), so a crash between the two
    // renames leaves an intact, readable payload with degraded metadata.
    const metaPath = `${localPath}.meta.json`;
    const meta = {
      key,
      sha256,
      size: buffer.length,
      contentType,
      storedAt,
      metadata: options.metadata || {},
    };
    atomicWrite(metaPath, JSON.stringify(meta, null, 2));

    // 2. If R2 is configured, also push to S3/R2 bucket with AWS SigV4
    let remoteStored = false;
    let remoteError = null;
    if (this.r2Config.isConfigured && this.r2Config.endpoint) {
      try {
        const res = await this._fetchR2('PUT', key, {
          body: buffer,
          payloadSha256: sha256,
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(buffer.length),
            ...buildR2MetaHeaders(sha256, options.metadata),
          },
        });
        if (res && res.ok) {
          remoteStored = true;
          this.lastError = null;
        } else {
          remoteError = res ? `R2 PUT failed with HTTP ${res.status}` : 'R2 PUT returned no response';
          this.lastError = remoteError;
        }
      } catch (err) {
        remoteError = err && err.message ? err.message : String(err);
        this.lastError = remoteError;
      }
      if (!remoteStored && this.requireDurable) {
        throw new Error(`Durable R2 vault upload failed: ${remoteError}`);
      }
    }

    return {
      key,
      size: buffer.length,
      sha256,
      contentType,
      storedAt,
      storageType: remoteStored ? 'r2' : 'local',
      localPath,
      ...(remoteError ? { degraded: true, remoteError } : {}),
    };
  }

  /**
   * Retrieves a document from the vault.
   *
   * @param {string} rawKey
   * @returns {Promise<Object|null>}
   */
  putDocumentSync(rawKey, data, options = {}) {
    if (this.requireDurable) {
      this.lastError = 'Durable vault (REQUIRE_DURABLE_VAULT=1) requires async putDocument for R2 durability';
      throw new Error(this.lastError);
    }
    const key = sanitizeKey(rawKey);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');

    if (buffer.length > MAX_DOCUMENT_SIZE) {
      throw new Error(`Document exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`);
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentType = options.contentType || 'application/octet-stream';
    const storedAt = new Date().toISOString();

    const localPath = this._localFilePath(key);
    atomicWrite(localPath, buffer);

    // Atomic sidecar metadata (see putDocument for crash-recovery rationale).
    const metaPath = `${localPath}.meta.json`;
    const meta = {
      key,
      sha256,
      size: buffer.length,
      contentType,
      storedAt,
      metadata: options.metadata || {},
    };
    atomicWrite(metaPath, JSON.stringify(meta, null, 2));

    return {
      key,
      size: buffer.length,
      sha256,
      contentType,
      storedAt,
      storageType: 'local',
      localPath,
    };
  }

  getDocumentSync(rawKey) {
    const key = sanitizeKey(rawKey);
    const localPath = this._localFilePath(key);
    const metaPath = `${localPath}.meta.json`;

    if (fs.existsSync(localPath)) {
      const data = fs.readFileSync(localPath);
      let meta = {};
      try {
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
      } catch {}

      return {
        key,
        data,
        size: data.length,
        sha256: meta.sha256 || crypto.createHash('sha256').update(data).digest('hex'),
        contentType: meta.contentType || 'application/octet-stream',
        storedAt: meta.storedAt || null,
        metadata: meta.metadata || {},
      };
    }

    return null;
  }

  async getDocument(rawKey) {
    this._assertDurableReady();
    const key = sanitizeKey(rawKey);
    const localPath = this._localFilePath(key);
    const metaPath = `${localPath}.meta.json`;

    if (fs.existsSync(localPath)) {
      const data = fs.readFileSync(localPath);
      let meta = {};
      try {
        if (fs.existsSync(metaPath)) {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        }
      } catch {}

      return {
        key,
        data,
        size: data.length,
        sha256: meta.sha256 || crypto.createHash('sha256').update(data).digest('hex'),
        contentType: meta.contentType || 'application/octet-stream',
        storedAt: meta.storedAt || null,
        metadata: meta.metadata || {},
      };
    }

    if (this.r2Config.isConfigured && this.r2Config.endpoint) {
      try {
        const res = await this._fetchR2('GET', key);
        if (res && res.ok) {
          const data = Buffer.from(await res.arrayBuffer());
          const contentType = res.headers?.get?.('content-type') || 'application/octet-stream';
          const lastModified = res.headers?.get?.('last-modified');
          const { sha256: remoteSha256, metadata } = extractR2Metadata(res.headers);
          const computedSha = sha256Hex(data);
          if (remoteSha256 && remoteSha256 !== computedSha) {
            this.lastError = `R2 object SHA-256 mismatch for ${key}`;
            throw new Error(this.lastError);
          }
          this.lastError = null;
          return {
            key,
            data,
            size: data.length,
            sha256: computedSha,
            contentType,
            storedAt: lastModified ? new Date(lastModified).toISOString() : null,
            metadata,
            storageType: 'r2',
          };
        }
        if (res && res.status !== 404) {
          this.lastError = `R2 GET failed with HTTP ${res.status}`;
          if (this.requireDurable) throw new Error(this.lastError);
        }
      } catch (err) {
        if (err && /SHA-256 mismatch|HTTP \d+/.test(err.message)) throw err;
        this.lastError = err && err.message ? err.message : String(err);
        if (this.requireDurable) throw err;
      }
    }

    return null;
  }

  /**
   * Inspects metadata for a document in the vault without reading full payload.
   *
   * @param {string} rawKey
   * @returns {Promise<Object>}
   */
  async headDocument(rawKey) {
    this._assertDurableReady();
    const key = sanitizeKey(rawKey);
    const localPath = this._localFilePath(key);
    const metaPath = `${localPath}.meta.json`;

    if (!fs.existsSync(localPath)) {
      if (this.r2Config.isConfigured && this.r2Config.endpoint) {
        try {
          const res = await this._fetchR2('HEAD', key);
          if (res && res.ok) {
            const rawLen = Number(res.headers?.get?.('content-length'));
            const lastModified = res.headers?.get?.('last-modified');
            const { sha256: remoteSha256, metadata } = extractR2Metadata(res.headers);
            this.lastError = null;
            return {
              exists: true,
              key,
              size: Number.isFinite(rawLen) ? rawLen : null,
              sha256: remoteSha256,
              contentType: res.headers?.get?.('content-type') || 'application/octet-stream',
              updatedAt: lastModified ? new Date(lastModified).toISOString() : null,
              metadata,
              storageType: 'r2',
            };
          }
          if (res && res.status !== 404) {
            this.lastError = `R2 HEAD failed with HTTP ${res.status}`;
            if (this.requireDurable) throw new Error(this.lastError);
          }
        } catch (err) {
          if (err && /HTTP \d+/.test(err.message)) throw err;
          this.lastError = err && err.message ? err.message : String(err);
          if (this.requireDurable) throw err;
        }
      }
      return { exists: false, key };
    }

    const stat = fs.statSync(localPath);
    let meta = {};
    try {
      if (fs.existsSync(metaPath)) {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch {}

    return {
      exists: true,
      key,
      size: stat.size,
      sha256: meta.sha256 || null,
      contentType: meta.contentType || 'application/octet-stream',
      updatedAt: stat.mtime.toISOString(),
      metadata: meta.metadata || {},
    };
  }

  /**
   * Deletes a document from the vault.
   *
   * @param {string} rawKey
   * @returns {Promise<Object>}
   */
  async deleteDocument(rawKey) {
    this._assertDurableReady();
    const key = sanitizeKey(rawKey);
    const localPath = this._localFilePath(key);
    const metaPath = `${localPath}.meta.json`;

    let deleted = false;
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      deleted = true;
    }
    if (fs.existsSync(metaPath)) {
      fs.unlinkSync(metaPath);
    }
    if (this.r2Config.isConfigured && this.r2Config.endpoint) {
      try {
        const res = await this._fetchR2('DELETE', key);
        if (res && res.ok) {
          deleted = true;
          this.lastError = null;
        } else if (res && res.status !== 404) {
          this.lastError = `R2 DELETE failed with HTTP ${res.status}`;
          if (this.requireDurable) throw new Error(this.lastError);
        }
      } catch (err) {
        if (err && /HTTP \d+/.test(err.message)) throw err;
        this.lastError = err && err.message ? err.message : String(err);
        if (this.requireDurable) throw err;
      }
    }

    return { key, deleted };
  }

  /**
   * Lists stored documents matching an optional prefix.
   *
   * @param {Object} [options={}] - { prefix, limit }
   * @returns {Promise<Array<Object>>}
   */
  async listDocuments(options = {}) {
    this._assertDurableReady();
    let prefix = '';
    if (options.prefix) {
      const hadTrailingSlash = String(options.prefix).trim().endsWith('/');
      const stripped = String(options.prefix).trim().replace(/\/+$/, '');
      if (stripped) {
        const clean = sanitizeKey(stripped);
        prefix = hadTrailingSlash ? `${clean}/` : clean;
      }
    }
    const limit = Math.min(options.limit || 100, 1000);
    const byKey = new Map();

    if (fs.existsSync(this.vaultDir)) {
      const walk = (currentDir, relDir = '') => {
        if (byKey.size >= limit) return;
        const entries = fs.readdirSync(currentDir, { withFileTypes: true });

        for (const entry of entries) {
          if (byKey.size >= limit) break;
          const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

          if (entry.isDirectory()) {
            walk(path.join(currentDir, entry.name), relPath);
          } else if (entry.isFile() && !entry.name.endsWith('.meta.json') && !entry.name.endsWith('.tmp')) {
            if (!prefix || relPath.startsWith(prefix)) {
              const stat = fs.statSync(path.join(currentDir, entry.name));
              byKey.set(relPath, {
                key: relPath,
                size: stat.size,
                updatedAt: stat.mtime.toISOString(),
                storageType: 'local',
              });
            }
          }
        }
      };

      walk(this.vaultDir);
    }

    if (this.r2Config.isConfigured && this.r2Config.endpoint) {
      let continuationToken = null;
      try {
        while (byKey.size < limit) {
          const listUrl = this._r2ListUrl({
            prefix,
            maxKeys: Math.min(1000, Math.max(1, limit - byKey.size)),
            continuationToken,
          });
          const res = await this._fetchR2Url('GET', listUrl);
          if (!res || !res.ok) {
            this.lastError = res ? `R2 ListObjectsV2 failed with HTTP ${res.status}` : 'R2 ListObjectsV2 returned no response';
            if (this.requireDurable) throw new Error(this.lastError);
            break;
          }
          const xml = typeof res.text === 'function' ? await res.text() : '';
          const page = parseListObjectsV2Xml(xml);
          for (const item of page.items) {
            if (byKey.size >= limit) break;
            if (item.key.endsWith('.meta.json') || item.key.endsWith('.tmp')) continue;
            if (prefix && !item.key.startsWith(prefix)) continue;
            const prev = byKey.get(item.key);
            byKey.set(item.key, {
              ...(prev || {}),
              key: item.key,
              size: item.size ?? prev?.size ?? null,
              updatedAt: item.updatedAt || prev?.updatedAt || null,
              storageType: 'r2',
            });
          }
          this.lastError = null;
          if (!page.isTruncated || !page.nextContinuationToken) break;
          continuationToken = page.nextContinuationToken;
        }
      } catch (err) {
        if (err && /HTTP \d+/.test(err.message)) throw err;
        this.lastError = err && err.message ? err.message : String(err);
        if (this.requireDurable) throw err;
      }
    }

    return [...byKey.values()].slice(0, limit);
  }
}

const defaultVault = new DocumentVault();

module.exports = {
  DocumentVault,
  defaultVault,
  sanitizeKey,
  createR2SignedHeaders,
  MAX_DOCUMENT_SIZE,
};
