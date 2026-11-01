'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { loadLedgerFromFile, verifyLedgerChain, withLedgerLock } = require('../server/discovery/evidence-ledger');
const MAX_BYTES = 256 * 1024 * 1024;
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const safeName = name => name === 'evidence-ledger.jsonl' || /^[a-z0-9-]+\/[a-f0-9]{64}(?:-[a-f0-9]{64})?\.(?:json|md)$/.test(name);

function validateArchive(data) {
  if (data?.version !== 1 || !data.files || !data.manifest || !Number.isFinite(Date.parse(data.createdAt))) throw new Error('Invalid evidence archive');
  const names = Object.keys(data.files);
  if (!names.length || names.length > 50001 || names.length !== Object.keys(data.manifest).length) throw new Error('Invalid evidence file manifest');
  const files = {}, referenced = new Set(['evidence-ledger.jsonl']);
  let size = 0;
  for (const name of names) {
    if (!safeName(name) || typeof data.files[name] !== 'string') throw new Error('Unsafe evidence archive path');
    const bytes = Buffer.from(data.files[name], 'base64'); size += bytes.length;
    if (size > MAX_BYTES || bytes.length !== data.manifest[name]?.bytes || digest(bytes) !== data.manifest[name]?.sha256) throw new Error('Evidence archive checksum/size mismatch');
    files[name] = bytes;
  }
  const rawLedger = files['evidence-ledger.jsonl'];
  if (!rawLedger) throw new Error('Evidence archive ledger missing');
  const chain = rawLedger.toString('utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  const valid = verifyLedgerChain(chain);
  if (!valid.valid || !chain.length || chain.at(-1).entryHash !== data.head || chain.length !== data.entries) throw new Error('Evidence archive chain/head mismatch');
  for (const entry of chain) {
    if (!/^[a-z0-9-]+$/.test(entry.source)) throw new Error('Invalid archive source');
    for (const [field, hash] of [['rawFile','rawFileSha256'],['markdownFile','markdownSha256']]) {
      if (field === 'markdownFile' && !entry.metadata[field]) continue;
      const name = `${entry.source}/${entry.metadata[field]}`;
      if (!safeName(name) || !files[name] || digest(files[name]) !== entry.metadata[hash]) throw new Error('Evidence archive is missing a referenced snapshot or has a digest mismatch');
      referenced.add(name);
    }
  }
  if (referenced.size !== names.length || names.some(name => !referenced.has(name))) throw new Error('Unreferenced evidence archive file');
  return {files,entries:chain.length,head:data.head,createdAt:data.createdAt};
}

function createEvidenceBackup({ sourceDir = process.env.PROPERTY_EVIDENCE_DIR, outputFile } = {}) {
  if (!sourceDir || !outputFile) throw new Error('Explicit evidence source directory and output file required');
  const root = fs.realpathSync(sourceDir), target = path.resolve(outputFile);
  const captured = withLedgerLock(path.join(root,'evidence-ledger.jsonl'), () => {
    const chain = loadLedgerFromFile(path.join(root,'evidence-ledger.jsonl'));
    if (!chain.length) throw new Error('No recorded evidence to back up');
    const files = {'evidence-ledger.jsonl':Buffer.from(chain.map(entry=>JSON.stringify(entry)).join('\n')+'\n')};
    let total = files['evidence-ledger.jsonl'].length;
    for (const entry of chain) for (const field of ['rawFile','markdownFile']) {
      if (!entry.metadata[field] && field === 'markdownFile') continue;
      const name = `${entry.source}/${entry.metadata[field]}`;
      if (!safeName(name)) throw new Error('Unsafe ledger snapshot reference');
      if (files[name]) continue;
      const fullPath = path.join(root,...name.split('/'));
      const stat = fs.lstatSync(fullPath);
      const relative = path.relative(root,fs.realpathSync(fullPath));
      if (!stat.isFile() || stat.isSymbolicLink() || relative.startsWith('..'+path.sep) || path.isAbsolute(relative)) throw new Error('Unsafe evidence snapshot');
      total += stat.size;
      if (total > MAX_BYTES) throw new Error('Evidence archive size limit exceeded');
      files[name] = fs.readFileSync(fullPath);
    }
    return {version:1,createdAt:new Date().toISOString(),entries:chain.length,head:chain.at(-1).entryHash,
      manifest:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,{bytes:bytes.length,sha256:digest(bytes)}])),
      files:Object.fromEntries(Object.entries(files).map(([name,bytes])=>[name,bytes.toString('base64')]))};
  });
  validateArchive(captured);
  const packed = zlib.gzipSync(Buffer.from(JSON.stringify(captured)));
  fs.mkdirSync(path.dirname(target),{recursive:true});
  const fd = fs.openSync(target,'wx',0o600);
  try {fs.writeFileSync(fd,packed);fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  return {file:target,sha256:digest(packed),head:captured.head,entries:captured.entries,bytes:packed.length};
}

function verifyEvidenceBackup(file, expectedSha256) {
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('Evidence archive size limit exceeded');
  const bytes = fs.readFileSync(file), sha256 = digest(bytes);
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error('Off-host archive digest mismatch');
  const data = JSON.parse(zlib.gunzipSync(bytes,{maxOutputLength:MAX_BYTES}).toString('utf8'));
  return {...validateArchive(data),sha256};
}

function restoreEvidenceBackup({ file, targetDir, expectedSha256 } = {}) {
  if (!targetDir) throw new Error('A new isolated restore directory is required');
  const verified = verifyEvidenceBackup(file,expectedSha256), target = path.resolve(targetDir);
  if (fs.existsSync(target)) throw new Error('Restore target must not already exist; live evidence is never overwritten');
  fs.mkdirSync(path.dirname(target),{recursive:true});
  // mkdir is the atomic no-overwrite reservation. A failed/interrupted restore
  // leaves this new isolated directory for inspection, never replaces live data.
  fs.mkdirSync(target,{mode:0o700});
  for (const [name,bytes] of Object.entries(verified.files)) {
    const output = path.join(target,...name.split('/'));
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,bytes,{flag:'wx',mode:0o600});
  }
  const chain = loadLedgerFromFile(path.join(target,'evidence-ledger.jsonl'));
  if (chain.at(-1)?.entryHash !== verified.head) throw new Error('Restored evidence head mismatch');
  return {targetDir:target,entries:verified.entries,head:verified.head,sha256:verified.sha256};
}

if (require.main === module) {
  const [action,first,second,third] = process.argv.slice(2);
  try {
    let result;
    if (action === 'create') result=createEvidenceBackup({sourceDir:first,outputFile:second});
    else if (action === 'verify') {const {files,...summary}=verifyEvidenceBackup(first,second);result=summary;}
    else if (action === 'restore') result=restoreEvidenceBackup({file:first,targetDir:second,expectedSha256:third});
    else throw new Error('Usage: node scripts/evidence-backup.js create SOURCE OUTPUT | verify ARCHIVE [SHA256] | restore ARCHIVE NEW_TARGET [SHA256]');
    console.log(JSON.stringify(result,null,2));
  } catch(error) {console.error(error.message);process.exitCode=1;}
}
module.exports={createEvidenceBackup,verifyEvidenceBackup,restoreEvidenceBackup};
