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

const DEFAULT_VAULT_DIR = path.resolve(process.cwd(), '.cache/vault');
const MAX_KEY_LENGTH = 512;
const MAX_DOCUMENT_SIZE = 50 * 1024 * 1024; // 50 MB safety clamp

function sanitizeKey(rawKey) {
  if (typeof rawKey !== 'string') throw new Error('Document key must be a string');
  const trimmed = rawKey.trim().replace(/^[\/\\]+/, '');
  if (!trimmed || trimmed.length > MAX_KEY_LENGTH) {
    throw new Error(`Document key must be between 1 and ${MAX_KEY_LENGTH} characters`);
  }
  if (/\.\.[\/\\]/.test(trimmed) || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error('Document key contains illegal path traversal or control characters');
  }
  return trimmed.replace(/\\/g, '/');
}

class DocumentVault {
  constructor(options = {}) {
    this.env = options.env || process.env;
    this.vaultDir = options.vaultDir || this.env.PROPERTY_VAULT_DIR || DEFAULT_VAULT_DIR;

    // R2 / S3 Configuration
    const r2Bucket = this.env.R2_BUCKET || this.env.AWS_S3_BUCKET || null;
    const r2AccessKey = this.env.R2_ACCESS_KEY_ID || this.env.AWS_ACCESS_KEY_ID || null;
    const r2SecretKey = this.env.R2_SECRET_ACCESS_KEY || this.env.AWS_SECRET_ACCESS_KEY || null;
    const r2AccountId = this.env.R2_ACCOUNT_ID || null;

    let r2Endpoint = this.env.R2_ENDPOINT || null;
    if (!r2Endpoint && r2AccountId) {
      r2Endpoint = `https://${r2AccountId}.r2.cloudflarestorage.com`;
    }

    this.r2Config = {
      isConfigured: Boolean(r2Bucket && r2AccessKey && r2SecretKey),
      bucket: r2Bucket,
      accessKeyId: r2AccessKey,
      secretAccessKey: r2SecretKey,
      endpoint: r2Endpoint,
    };

    this.fetchImpl = options.fetchImpl || fetch;
  }

  get storageType() {
    return this.r2Config.isConfigured ? 'r2' : 'local';
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
    const key = sanitizeKey(rawKey);
    const buffer = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');

    if (buffer.length > MAX_DOCUMENT_SIZE) {
      throw new Error(`Document exceeds maximum size of ${MAX_DOCUMENT_SIZE} bytes`);
    }

    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    const contentType = options.contentType || 'application/octet-stream';
    const storedAt = new Date().toISOString();

    // 1. Always store locally as fast local cache / durable backup
    const localPath = this._localFilePath(key);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });

    const tempFile = `${localPath}.${crypto.randomUUID()}.tmp`;
    fs.writeFileSync(tempFile, buffer);
    fs.renameSync(tempFile, localPath);

    // Write sidecar metadata
    const metaPath = `${localPath}.meta.json`;
    const meta = {
      key,
      sha256,
      size: buffer.length,
      contentType,
      storedAt,
      metadata: options.metadata || {},
    };
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

    // 2. If R2 is configured, also push to S3/R2 bucket
    let remoteStored = false;
    if (this.r2Config.isConfigured && this.r2Config.endpoint) {
      try {
        const remoteUrl = `${this.r2Config.endpoint}/${this.r2Config.bucket}/${encodeURI(key)}`;
        const res = await this.fetchImpl(remoteUrl, {
          method: 'PUT',
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(buffer.length),
            'x-amz-content-sha256': sha256,
          },
          body: buffer,
        });
        remoteStored = res.ok;
      } catch {
        remoteStored = false;
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
    };
  }

  /**
   * Retrieves a document from the vault.
   *
   * @param {string} rawKey
   * @returns {Promise<Object|null>}
   */
  async getDocument(rawKey) {
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

  /**
   * Inspects metadata for a document in the vault without reading full payload.
   *
   * @param {string} rawKey
   * @returns {Promise<Object>}
   */
  async headDocument(rawKey) {
    const key = sanitizeKey(rawKey);
    const localPath = this._localFilePath(key);
    const metaPath = `${localPath}.meta.json`;

    if (!fs.existsSync(localPath)) {
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

    return { key, deleted };
  }

  /**
   * Lists stored documents matching an optional prefix.
   *
   * @param {Object} [options={}] - { prefix, limit }
   * @returns {Promise<Array<Object>>}
   */
  async listDocuments(options = {}) {
    const prefix = options.prefix ? sanitizeKey(options.prefix) : '';
    const limit = Math.min(options.limit || 100, 1000);

    if (!fs.existsSync(this.vaultDir)) return [];

    const results = [];
    const walk = (currentDir, relDir = '') => {
      if (results.length >= limit) return;
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });

      for (const entry of entries) {
        if (results.length >= limit) break;
        const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          walk(path.join(currentDir, entry.name), relPath);
        } else if (entry.isFile() && !entry.name.endsWith('.meta.json') && !entry.name.endsWith('.tmp')) {
          if (!prefix || relPath.startsWith(prefix)) {
            const stat = fs.statSync(path.join(currentDir, entry.name));
            results.push({
              key: relPath,
              size: stat.size,
              updatedAt: stat.mtime.toISOString(),
            });
          }
        }
      }
    };

    walk(this.vaultDir);
    return results;
  }
}

const defaultVault = new DocumentVault();

module.exports = {
  DocumentVault,
  defaultVault,
  sanitizeKey,
  MAX_DOCUMENT_SIZE,
};
