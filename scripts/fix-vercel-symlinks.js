'use strict';

const fs = require('node:fs');
const path = require('node:path');

const outputDir = path.resolve(__dirname, '..', '.vercel', 'output');
if (!fs.existsSync(outputDir)) {
  console.log('[fix-vercel-symlinks] .vercel/output does not exist; skipping');
  process.exit(0);
}

let count = 0;
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      const target = fs.readlinkSync(fullPath);
      if (target.includes('\\')) {
        const fixed = target.split('\\').join('/');
        fs.unlinkSync(fullPath);
        // On Windows, use 'junction' or 'dir'/'file' depending on target
        try {
          fs.symlinkSync(fixed, fullPath, 'dir');
        } catch {
          fs.symlinkSync(fixed, fullPath, 'junction');
        }
        count++;
        console.log(`[fix-symlink] ${path.relative(outputDir, fullPath)}: "${target}" -> "${fixed}"`);
      }
    } else if (entry.isDirectory()) {
      walk(fullPath);
    }
  }
}

walk(outputDir);
console.log(`[fix-vercel-symlinks] Normalized ${count} symlink targets to POSIX forward slashes.`);
