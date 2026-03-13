'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'pixel-auditor');

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (p.endsWith('.ts') || p.endsWith('.js')) out.push(p);
  }
  return out;
}

function pickPkg(spec) {
  if (!spec || spec.startsWith('.') || spec.startsWith('/')) return null;
  // convierte @scope/pkg/subpath => @scope/pkg
  if (spec.startsWith('@')) {
    const parts = spec.split('/');
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : spec;
  }
  // pkg/subpath => pkg
  return spec.split('/')[0];
}

const files = walk(ROOT);
const pkgs = new Set();

const importRe = /from\s+['"]([^'"]+)['"]/g;
const reqRe = /require\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const f of files) {
  const s = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = importRe.exec(s))) {
    const p = pickPkg(m[1]);
    if (p) pkgs.add(p);
  }
  while ((m = reqRe.exec(s))) {
    const p = pickPkg(m[1]);
    if (p) pkgs.add(p);
  }
}

console.log('\nPixel Auditor external deps:\n');
console.log([...pkgs].sort().join('\n') || '(none)');
console.log('\nTotal:', pkgs.size);
