'use strict';
/**
 * scripts/swarm/memory-store.js — Queryable swarm memory with episode snapshots.
 *
 * Supersedes plain markdown for runtime use while still emitting human-readable
 * episodes under memory/episodes/. Every mutation persists atomically via
 * temp-file + rename. Node builtins only.
 *
 * Namespace/objective convention: swarm goals live at key "objective" in the
 * "swarm" namespace (i.e. memory.get('objective', 'swarm')).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_STORE =
  process.env.SWARM_MEMORY_PATH || path.join(ROOT, '.cache', 'swarm-memory.json');
const EPISODES_DIR = path.join(ROOT, 'memory', 'episodes');

function atomicWriteJson(filePath, data) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(data, null, 2);
  let lastErr = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tmp = path.join(
      dir,
      `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${attempt}.tmp`
    );
    try {
      fs.writeFileSync(tmp, payload, 'utf8');
      fs.renameSync(tmp, filePath);
      return;
    } catch (err) {
      lastErr = err;
      try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
      } catch (_) {}
      // Windows can briefly hold a rename lock (EPERM/EBUSY); back off and retry.
      if (err && (err.code === 'EPERM' || err.code === 'EBUSY' || err.code === 'EACCES')) {
        const until = Date.now() + 5 + attempt * 10;
        while (Date.now() < until) {
          /* spin briefly — no async in this helper */
        }
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9_-]+/)
    .filter((t) => t.length > 1);
}

class MemoryStore {
  /**
   * @param {string} [storePath] JSON persistence path (default .cache/swarm-memory.json)
   */
  constructor(storePath) {
    this.storePath = storePath || DEFAULT_STORE;
    this.data = { namespaces: {} };
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
        if (raw && typeof raw === 'object' && raw.namespaces) {
          this.data = raw;
        }
      }
    } catch (_) {
      this.data = { namespaces: {} };
    }
    if (!this.data.namespaces) this.data.namespaces = {};
  }

  _persist() {
    atomicWriteJson(this.storePath, this.data);
  }

  _ns(namespace) {
    const ns = namespace || 'default';
    if (!this.data.namespaces[ns]) this.data.namespaces[ns] = {};
    return this.data.namespaces[ns];
  }

  set(key, value, namespace = 'default') {
    if (!key || typeof key !== 'string') throw new Error('MemoryStore.set requires a string key');
    const ns = this._ns(namespace);
    ns[key] = {
      value,
      updatedAt: new Date().toISOString(),
      citations: [],
    };
    this._persist();
    return ns[key];
  }

  get(key, namespace = 'default') {
    const ns = this.data.namespaces[namespace || 'default'];
    if (!ns || !Object.prototype.hasOwnProperty.call(ns, key)) return undefined;
    return ns[key].value;
  }

  /**
   * Case-insensitive substring/token match across keys and stringified values.
   * @param {string} searchTerms
   * @param {string} [namespace] restrict to one namespace; omit to search all
   * @returns {Array<{namespace:string,key:string,value:any,score:number,updatedAt:string}>}
   */
  query(searchTerms, namespace) {
    if (!searchTerms) return [];
    const tokens = tokenize(searchTerms);
    if (tokens.length === 0) return [];
    const needle = String(searchTerms).toLowerCase();

    const hits = [];
    const namespaces = namespace
      ? [namespace]
      : Object.keys(this.data.namespaces);

    for (const nsName of namespaces) {
      const ns = this.data.namespaces[nsName];
      if (!ns) continue;
      for (const [key, entry] of Object.entries(ns)) {
        const keyLower = key.toLowerCase();
        const valueStr = JSON.stringify(entry.value).toLowerCase();
        let score = 0;
        if (keyLower.includes(needle)) score += 10;
        if (valueStr.includes(needle)) score += 5;
        for (const token of tokens) {
          if (keyLower.includes(token)) score += 3;
          if (valueStr.includes(token)) score += 1;
        }
        if (score > 0) {
          hits.push({
            namespace: nsName,
            key,
            value: entry.value,
            score,
            updatedAt: entry.updatedAt,
          });
        }
      }
    }

    hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
    return hits;
  }

  list(namespace = 'default') {
    const ns = this.data.namespaces[namespace || 'default'];
    if (!ns) return [];
    return Object.keys(ns).sort();
  }

  delete(key, namespace = 'default') {
    const ns = this.data.namespaces[namespace || 'default'];
    if (!ns || !Object.prototype.hasOwnProperty.call(ns, key)) return false;
    delete ns[key];
    this._persist();
    return true;
  }

  /** @returns {Object} plain key→value map for the namespace */
  exportNs(namespace = 'default') {
    const ns = this.data.namespaces[namespace || 'default'];
    if (!ns) return {};
    const out = {};
    for (const [key, entry] of Object.entries(ns)) {
      out[key] = entry.value;
    }
    return out;
  }

  importNs(obj, namespace = 'default') {
    if (!obj || typeof obj !== 'object') throw new Error('importNs requires a plain object');
    const ns = this._ns(namespace);
    for (const [key, value] of Object.entries(obj)) {
      ns[key] = { value, updatedAt: new Date().toISOString(), citations: [] };
    }
    this._persist();
    return Object.keys(obj).length;
  }

  /** Render a namespace as markdown with citations. */
  toMarkdown(namespace = 'default') {
    const nsName = namespace || 'default';
    const ns = this.data.namespaces[nsName] || {};
    const stamp = new Date().toISOString();
    const lines = [
      `# swarm episode — namespace \`${nsName}\``,
      '',
      `Generated: ${stamp}`,
      `Source store: \`${path.relative(ROOT, this.storePath).replace(/\\/g, '/')}\``,
      '',
    ];
    const keys = Object.keys(ns).sort();
    if (keys.length === 0) {
      lines.push('_No entries._', '');
    }
    for (const key of keys) {
      const entry = ns[key];
      lines.push(`## ${key}`);
      lines.push('');
      const rendered =
        typeof entry.value === 'string'
          ? entry.value
          : '```json\n' + JSON.stringify(entry.value, null, 2) + '\n```';
      lines.push(rendered, '');
      lines.push(
        `- updated: ${entry.updatedAt}`,
        `- citation: memory-store \`${nsName}/${key}\` @ ${entry.updatedAt}`,
        ''
      );
    }
    return lines.join('\n');
  }

  /**
   * Write a human-readable snapshot to memory/episodes/swarm-<timestamp>.md.
   * @returns {string} absolute path of the written episode
   */
  flushToEpisodes(namespace = 'default') {
    fs.mkdirSync(EPISODES_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filePath = path.join(EPISODES_DIR, `swarm-${stamp}.md`);
    fs.writeFileSync(filePath, this.toMarkdown(namespace), 'utf8');
    return filePath;
  }
}

module.exports = { MemoryStore, DEFAULT_STORE, EPISODES_DIR, atomicWriteJson };
