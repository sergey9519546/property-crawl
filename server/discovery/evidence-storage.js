'use strict';
const fs = require('node:fs');
const path = require('node:path');

function evidenceStorageStatus({ env = process.env, evidenceDir, mountInfo, realpath = fs.realpathSync } = {}) {
  const required = env.PROPERTY_REQUIRE_DURABLE_EVIDENCE === '1';
  const fallback = env.RENDER === 'true' ? 'ephemeral_filesystem' : 'local_filesystem_only';
  const result = { durability:fallback, required, mountVerified:false, backupVerified:false };
  const mount = env.PROPERTY_DURABLE_MOUNT_PATH;
  const requireDurableVault = env.REQUIRE_DURABLE_VAULT === '1' || env.REQUIRE_DURABLE_VAULT === 'true';
  const r2Bucket = env.R2_BUCKET || env.AWS_S3_BUCKET || null;
  const r2AccessKey = env.R2_ACCESS_KEY_ID || env.AWS_ACCESS_KEY_ID || null;
  const r2SecretKey = env.R2_SECRET_ACCESS_KEY || env.AWS_SECRET_ACCESS_KEY || null;
  const r2Endpoint = env.R2_ENDPOINT || (env.R2_ACCOUNT_ID ? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
  const r2Configured = Boolean(r2Bucket && r2AccessKey && r2SecretKey && r2Endpoint);
  if (!mount) {
    if (r2Configured) {
      return {
        durability: 'r2_durable_vault',
        required: Boolean(required || requireDurableVault),
        mountVerified: false,
        r2Configured: true,
        vaultBucket: String(r2Bucket),
        backupVerified: false,
      };
    }
    if (requireDurableVault) {
      return {
        ...result,
        required: true,
        writesBlocked: true,
        reason: 'Durable R2 vault (REQUIRE_DURABLE_VAULT=1) requires R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_ENDPOINT',
      };
    }
    return { ...result, ...(required ? {writesBlocked:true,reason:'Durable evidence mount is not configured'} : {}) };
  }
  if (!evidenceDir) return { ...result, ...(required ? {writesBlocked:true,reason:'Durable evidence mount is not configured'} : {}) };
  try {
    const mountedPath = realpath(mount), resolvedEvidence = realpath(evidenceDir);
    const relative = path.relative(mountedPath, resolvedEvidence);
    if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw new Error('Evidence directory resolves outside the durable mount');
    const table = mountInfo ?? fs.readFileSync('/proc/self/mountinfo','utf8');
    const observed = table.split('\n').some(line => {
      const [before, after] = line.split(' - ');
      if (!after) return false;
      const fields = before.split(' ');
      const point = fields[4]?.replace(/\\([0-7]{3})/g, (_, code) => String.fromCharCode(parseInt(code,8)));
      return point === mountedPath && !['overlay','tmpfs','ramfs','squashfs'].includes(after.split(' ')[0]);
    });
    if (!observed) throw new Error('Configured durable mount was not observed in the runtime mount table');
    return { ...result, durability:'mounted_filesystem', mountVerified:true };
  } catch (error) {
    return { ...result, ...(required ? {writesBlocked:true} : {}), reason:error.message };
  }
}

function assertEvidenceStorage(env = process.env) {
  if (env.PROPERTY_REQUIRE_DURABLE_EVIDENCE !== '1') return;
  const evidenceDir = env.PROPERTY_EVIDENCE_DIR;
  if (!evidenceDir) throw new Error('PROPERTY_EVIDENCE_DIR is required for durable evidence');
  // Directory creation is inside the declared mount; mount verification still
  // fails closed if the host accidentally started without attaching its disk.
  if (!env.PROPERTY_DURABLE_MOUNT_PATH) throw new Error('PROPERTY_DURABLE_MOUNT_PATH is required');
  const relative = path.relative(path.resolve(env.PROPERTY_DURABLE_MOUNT_PATH),path.resolve(evidenceDir));
  if (relative === '..' || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw new Error('Evidence directory is outside the configured mount');
  fs.mkdirSync(evidenceDir,{recursive:true});
  const status = evidenceStorageStatus({env,evidenceDir});
  if (status.writesBlocked) throw new Error(status.reason);
}
module.exports = { evidenceStorageStatus, assertEvidenceStorage };
