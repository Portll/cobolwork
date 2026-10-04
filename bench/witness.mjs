// SPDX-License-Identifier: AGPL-3.0-or-later
// A witness feed from execution labels (docs/spec/reach.md §9.5): each confirmed finding becomes a
// reproduced result that cites the ironwork run that confirmed it, so a scan given the feed checks
// the run's journal before it confirms anything.
//
//   node bench/witness.mjs <labels.json> [--repo name] [--out feed.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WITNESS_VERSION } from '../lib/exploitability.mjs';

export function witnessFeed(doc, { repo = null, recorded = new Date().toISOString().slice(0, 10) } = {}) {
  const results = {};
  for (const l of doc.labels || []) {
    if (l.source !== 'execution' || l.label !== 'confirmed' || !l.fingerprint || !l.run) continue;
    if (repo != null && l.repo !== repo) continue;
    const on = `${l.run.slice(0, 4)}-${l.run.slice(4, 6)}-${l.run.slice(6, 8)}`;
    results[l.fingerprint] = {
      outcome: 'reproduced', by: 'bench/label.mjs', on, system: 'ironwork',
      ...(l.variant ? { reference: l.variant } : {}),
      evidence: { dir: resolve(doc.evidence), run: l.run },
    };
  }
  return { version: WITNESS_VERSION, witness: `ironwork execution labels${repo ? ` for ${repo}` : ''}`, recorded, results };
}

function main(argv) {
  let file = null;
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--repo') opts.repo = argv[++i];
    else if (a === '--out') opts.out = argv[++i];
    else file = a;
  }
  if (!file) {
    process.stderr.write('usage: node bench/witness.mjs <labels.json> [--repo name] [--out feed.json]\n');
    return 2;
  }
  const text = `${JSON.stringify(witnessFeed(JSON.parse(readFileSync(file, 'utf8')), opts), null, 1)}\n`;
  if (opts.out) writeFileSync(opts.out, text); else process.stdout.write(text);
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = main(process.argv.slice(2));
