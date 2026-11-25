// SPDX-License-Identifier: AGPL-3.0-or-later
// Distinct refusal reasons for the named operations over the given split directories, with examples.
//   node diag/hlasm-refusal-samples.mjs OP[,OP...] <split-dir>... [--per N]
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeSource } from '../lib/sources.mjs';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
const args = process.argv.slice(2);
const perAt = args.indexOf('--per');
const per = perAt < 0 ? 3 : Number(args.splice(perAt, 2)[1]);
const ops = new Set(args[0].split(','));
const dirs = args.slice(1);
const walk = (d, o = []) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); e.isDirectory() ? walk(p, o) : o.push(p); } return o; };
const by = new Map();
for (const dir of dirs) for (const f of walk(dir)) {
  const text = decodeSource(readFileSync(f)).text;
  if (![...ops].some((op) => text.includes(op))) continue;
  for (const st of readHlasmStatements(text).statements) {
    if (!ops.has(String(st.operation).toUpperCase())) continue;
    const r = parseHlasmStatement(st);
    if (r.status === 'parsed') continue;
    const key = st.operation + ': ' + (r.reason || r.status).replace(/'[^']*'/g, "'…'").replace(/\b\d+\b/g, 'n');
    if (!by.has(key)) by.set(key, { n: 0, ex: [] });
    const e = by.get(key); e.n++;
    if (e.ex.length < per) e.ex.push(st.field.slice(0, 100));
  }
}
for (const [k, v] of [...by].sort((a, b) => b[1].n - a[1].n).slice(0, 40)) console.log(String(v.n).padStart(5), k.slice(0, 90), '\n       ', v.ex.map((x) => JSON.stringify(x)).join('  '));
