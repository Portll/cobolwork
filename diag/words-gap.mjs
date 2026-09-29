// Compares each word Set lib/words.mjs exports with the same-named Set a reference module exports.
//   node diag/words-gap.mjs <reference.mjs> [--list]
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as clean from '../lib/words.mjs';

const [refPath] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const list = process.argv.includes('--list');
if (!refPath) {
  console.error('usage: node diag/words-gap.mjs <reference.mjs> [--list]');
  process.exit(2);
}
const ref = await import(pathToFileURL(resolve(refPath)).href);

const rows = [];
for (const [name, theirs] of Object.entries(ref)) {
  if (!(theirs instanceof Set)) continue;
  const ours = clean[name] instanceof Set ? clean[name] : new Set();
  const missing = [...theirs].filter((w) => !ours.has(w)).sort();
  const extra = [...ours].filter((w) => !theirs.has(w)).sort();
  rows.push({ name, reference: theirs.size, ours: ours.size, missing, extra });
}

for (const r of rows) {
  console.log(`${r.name.padEnd(24)} reference ${String(r.reference).padStart(5)}  ours ${String(r.ours).padStart(5)}  missing ${String(r.missing.length).padStart(4)}  only ours ${String(r.extra.length).padStart(4)}`);
  if (list && r.missing.length) console.log(`  missing: ${r.missing.join(' ')}`);
}
const total = rows.reduce((n, r) => n + r.missing.length, 0);
console.log(`\n${total} word(s) in the reference have no attested source here yet`);
