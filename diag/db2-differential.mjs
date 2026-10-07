// SPDX-License-Identifier: AGPL-3.0-or-later
// The Db2 reader against JSqlParser, a mature SQL parser, on the distinct statements of a corpus:
// where both parse, where both refuse, and each statement only one of them parses. Neither speaks
// Db2 for z/OS exactly, so a disagreement is something to read, not a verdict.
//
//   node diag/db2-differential.mjs <dir> --jsqlparser <jsqlparser.jar> [--out disagreements.json]
//
// The jar is JSqlParser 5.1 from Maven Central; it is run with `java`, and cobolwork does not
// depend on it.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : null);
const root = args[0];
const jar = flag('jsqlparser');
if (!root || !jar) { console.error('usage: node diag/db2-differential.mjs <dir> --jsqlparser <jar> [--out file]'); process.exit(2); }

const files = [];
const walk = (d) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(sql|ddl|db2)$/i.test(e)) files.push(p); } };
walk(root);

const seen = new Map();
for (const f of files) {
  const src = readFileSync(f, 'latin1');
  const lines = src.split(/\r?\n/);
  for (const st of readDb2(src).statements) {
    const text = lines.slice(st.line - 1, st.endLine).join('\n').trim().replace(/;\s*$/, '');
    if (seen.has(text)) continue;
    const r = parseDb2Statement(st);
    seen.set(text, { file: relative(root, f), line: st.line, kind: r.kind, reader: r.status === 'parsed' ? 'parsed' : 'refused' });
  }
}

const texts = [...seen.keys()];
const input = texts.map((t) => t.replace(/[\r\u2028\u2029\u0085]/g, ' ').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/\t/g, '\\t')).join('\n') + '\n';
const verdicts = execFileSync('java', ['-cp', jar, join(HERE, 'db2-differential', 'Diff.java')], { input, maxBuffer: 64 << 20 }).toString().trim().split('\n');

const cells = { both: 0, neither: 0, readerOnly: 0, jsqlparserOnly: 0 };
const byKind = {};
const disagreements = [];
texts.forEach((t, i) => {
  const m = seen.get(t);
  const theirs = verdicts[i] === 'ok';
  const cell = m.reader === 'parsed' ? (theirs ? 'both' : 'readerOnly') : (theirs ? 'jsqlparserOnly' : 'neither');
  cells[cell]++;
  (byKind[m.kind] ||= { both: 0, neither: 0, readerOnly: 0, jsqlparserOnly: 0 })[cell]++;
  if (cell === 'readerOnly' || cell === 'jsqlparserOnly') disagreements.push({ ...m, only: cell === 'readerOnly' ? 'reader' : 'jsqlparser', text: t });
});
console.log(JSON.stringify({ files: files.length, statements: texts.length, ...cells, byKind }, null, 1));
const out = flag('out');
if (out) writeFileSync(out, JSON.stringify(disagreements, null, 1));
