'use strict';
const fs = require('node:fs');
const path = require('node:path');

function evidenceStorageStatus({ env = process.env, evidenceDir, mountInfo, realpath = fs.realpathSync } = {}) {
  const required = env.PROPERTY_REQUIRE_DURABLE_EVIDENCE === '1';
  const fallback = env.RENDER === 'true' ? 'ephemeral_filesystem' : 'local_filesystem_only';
  const result = { durability:fallback, required, mountVerified:false, backupVerified:false };
  const mount = env.PROPERTY_DURABLE_MOUNT_PATH;
  if (!mount || !evidenceDir) return { ...result, ...(required ? {writesBlocked:true,reason:'Durable evidence mount is not configured'} : {}) };
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
