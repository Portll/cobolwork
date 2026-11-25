// SPDX-License-Identifier: AGPL-3.0-or-later
// Counts authorized and privileged code in an HLASM corpus root by parsed operation: the rule
// table's classes (readHlasm), MODESET state changes, and privileged instructions and authorized
// macros the table does not hold. Open code and macro definitions are counted apart.
//   node diag/hlasm-authorized-count.mjs <corpus-root> <split>[,<split>...] [--json out.json]
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readHlasm } from '../lib/hlasm.mjs';
import { foldStatements } from '../lib/bms.mjs';

const [root, splitArg] = process.argv.slice(2);
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;

const EXTRA = {
  privileged: ['LPSW', 'LPSWE', 'SSM', 'STNSM', 'STOSM', 'LCTL', 'LCTLG', 'STCTL', 'STCTG', 'ISKE', 'SSKE', 'IVSK', 'IPK', 'LRA', 'LRAG', 'PTLB', 'IPTE', 'STAP', 'SIGP', 'SIO', 'SIOF', 'TIO', 'HIO', 'SSCH', 'TSCH', 'MSCH', 'STSCH', 'CSCH', 'HSCH', 'RSCH', 'SAL', 'STIDP'],
  'address-space': ['SAC', 'SACF', 'BSA', 'BAKR', 'EREG', 'ESTA', 'MSTA', 'ESAR', 'EPAR', 'IAC', 'PALB', 'LURA', 'STURA'],
  'cross-memory-setup': ['AXSET', 'AXRES', 'AXEXT', 'AXFRE', 'ATSET', 'ETCRE', 'ETDEF', 'ETCON', 'ETDES', 'ETDIS', 'LXRES', 'LXFRE', 'PCLINK', 'ALESERV', 'IEAMSCHD'],
  'authorized-macro': ['SETLOCK', 'SETFRR', 'SCHEDULE', 'SYNCH', 'SYNCHX', 'SVCUPDTE', 'PGFIX', 'PGFREE', 'PGSER', 'SDUMP', 'SDUMPX', 'CALLRTM', 'PURGEDQ', 'CHAP', 'NUCLKUP', 'LOCASCB', 'IEAMSCHD', 'IEFSSREQ'],
  'authorization-check': ['TESTAUTH'],
};
const EXTRA_CLASS = new Map(Object.entries(EXTRA).flatMap(([k, ops]) => ops.map((o) => [o, k])));

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

const result = {};
for (const split of splitArg.split(',')) {
  const base = join(root, split);
  const r = { files: 0, statements: 0, byClass: {}, byOperation: {}, filesWith: {}, reposWith: {}, modeset: { open: 0, inMacro: 0, files: 0, repos: new Set() } };
  for (const repo of readdirSync(base).sort()) {
    for (const f of walk(join(base, repo))) {
      const text = readFileSync(f, 'latin1');
      const h = readHlasm(text);
      if (h.kind !== 'hlasm') continue;
      r.files++;
      r.statements += h.statements;
      const classesHere = new Set();
      let stateChanges = 0;
      for (const o of h.operations) {
        const where = o.inMacro ? 'inMacro' : 'open';
        ((r.byClass[o.class] ||= { open: 0, inMacro: 0 })[where])++;
        ((r.byOperation[o.name] ||= { class: o.class, open: 0, inMacro: 0 })[where])++;
        classesHere.add(o.class);
        if (o.stateChange) { r.modeset[where]++; stateChanges++; }
      }
      let depth = 0;
      for (const s of foldStatements(text).statements) {
        if (s.kind !== 'statement') continue;
        const op = String(s.operation || '').toUpperCase();
        if (op === 'MACRO') { depth++; continue; }
        if (op === 'MEND') { depth = Math.max(0, depth - 1); continue; }
        const cls = EXTRA_CLASS.get(op);
        if (!cls) continue;
        const where = depth ? 'inMacro' : 'open';
        ((r.byClass[cls] ||= { open: 0, inMacro: 0 })[where])++;
        ((r.byOperation[op] ||= { class: cls, open: 0, inMacro: 0 })[where])++;
        classesHere.add(cls);
      }
      for (const c of classesHere) {
        r.filesWith[c] = (r.filesWith[c] || 0) + 1;
        (r.reposWith[c] ||= new Set()).add(repo);
      }
      if (stateChanges) { r.modeset.files++; r.modeset.repos.add(repo); }
    }
  }
  r.reposWith = Object.fromEntries(Object.entries(r.reposWith).map(([k, v]) => [k, v.size]));
  r.modeset.repos = r.modeset.repos.size;
  r.byOperation = Object.fromEntries(Object.entries(r.byOperation).sort((a, b) => (b[1].open + b[1].inMacro) - (a[1].open + a[1].inMacro)));
  result[split] = r;
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(result, null, 1));
for (const [split, r] of Object.entries(result)) {
  console.log(`## ${split}: ${r.files} files, ${r.statements} statements; MODESET to key 0 / supervisor: open ${r.modeset.open}, in macros ${r.modeset.inMacro}, ${r.modeset.files} files, ${r.modeset.repos} repos`);
  for (const [c, v] of Object.entries(r.byClass).sort((a, b) => (b[1].open + b[1].inMacro) - (a[1].open + a[1].inMacro))) {
    console.log(`  ${c.padEnd(24)} open ${String(v.open).padStart(6)}  inMacro ${String(v.inMacro).padStart(6)}  files ${String(r.filesWith[c]).padStart(5)}  repos ${String(r.reposWith[c]).padStart(4)}`);
  }
}
