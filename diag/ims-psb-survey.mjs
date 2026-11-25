// SPDX-License-Identifier: AGPL-3.0-or-later
// Counts, over a corpus, the operands the IMS PSB macros are written with: per PCB, SENSEG, SENFLD and
// PSBGEN, how many carry a label, each positional operand, and each keyword's values (a PCB's keyed
// by its TYPE). Under name-like and numeric keywords a value is folded to <name> or <int>.
//   node diag/ims-psb-survey.mjs <corpus-root>
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readIms } from '../lib/ims/read.mjs';
import { parseOperands } from '../lib/cards.mjs';

const root = process.argv[2];
if (!root) { console.error('usage: node diag/ims-psb-survey.mjs <corpus-root>'); process.exit(2); }
const SURVEYED = ['PCB', 'SENSEG', 'SENFLD', 'PSBGEN'];
const FOLDED = /NAME|START|KEYLEN|SIZE|LTERM|PARENT|PROCSEQ|INDICES|REMARKS/;

function sources(dir, found = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sources(p, found);
    else if (/\.(dbd|psb|asm|mac|mlc)$/i.test(p)) found.push(p);
  }
  return found;
}

const stats = {};
for (const file of sources(root)) {
  for (const st of readIms(readFileSync(file, 'latin1')).statements) {
    if (!SURVEYED.includes(st.operation)) continue;
    const ops = parseOperands(st.field);
    const s = (stats[st.operation] ||= { n: 0, labels: 0, positional: {}, kw: {} });
    s.n++;
    if (st.name) s.labels++;
    for (const p of ops.positional) s.positional[p] = (s.positional[p] || 0) + 1;
    const type = st.operation === 'PCB' ? (ops.keywords.get('TYPE') || '?') : '';
    for (const [k, v] of ops.keywords) {
      const values = (s.kw[type ? `${type}:${k}` : k] ||= {});
      const value = FOLDED.test(k) ? (/^\d+$/.test(v) ? '<int>' : '<name>') : v;
      values[value] = (values[value] || 0) + 1;
    }
  }
}
console.log(JSON.stringify(stats, null, 1));
