// SPDX-License-Identifier: AGPL-3.0-or-later
// Runs the PL/I benchmark cases: each directory of bench/pli/ with a manifest is scanned by the flow
// engine with PL/I read and by the PL/I rules, and its expectations checked.
//
//   node diag/pli-bench.mjs [bench/pli] [--json]
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { scan, RULES as FLOW_RULES } from '../lib/sets/flow.mjs';
import { programOf, checkProgram, PLI_RULES } from '../lib/pli/rules/index.mjs';
import { sourceText } from '../lib/pli/lex.mjs';

export function runCase(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  const flow = scan(dir, { pli: true }).findings.map((f) => ({ rule: f.rule, file: f.path.split('/').pop() }));
  const own = readdirSync(dir).filter((f) => /\.pli$/i.test(f)).flatMap((f) => checkProgram(programOf(f, sourceText(readFileSync(join(dir, f))))).map((x) => ({ rule: x.rule, file: f })));
  const found = [...flow, ...own];
  const rules = [...(manifest.expect || []).map((e) => e.rule), ...(manifest.negativeFor || [])];
  const unknown = rules.filter((r) => !(r in FLOW_RULES) && !(r in PLI_RULES));
  const missing = (manifest.expect || []).filter((e) => !found.some((f) => f.rule === e.rule && (!e.file || f.file === e.file)));
  const unexpected = (manifest.negativeFor || []).filter((r) => found.some((f) => f.rule === r));
  // A case may name a limit it is known to hit; it reports as open rather than pass or fail.
  const verdict = unknown.length ? 'rule-not-built' : missing.length ? 'missed' : unexpected.length ? (manifest.open ? 'open' : 'false-positive') : 'pass';
  return { id: manifest.id, verdict, unknown, missing: missing.map((m) => m.rule), unexpected, found: [...new Set(found.map((f) => f.rule))] };
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || 'bench/pli';
  const dirs = readdirSync(root).map((d) => join(root, d)).filter((d) => statSync(d).isDirectory() && existsSync(join(d, 'manifest.json'))).sort();
  const results = dirs.map((d) => ({ dir: relative(root, d), ...runCase(d) }));
  if (args.includes('--json')) process.stdout.write(JSON.stringify(results, null, 1) + '\n');
  else for (const r of results) console.log(`${r.verdict.padEnd(15)} ${r.dir}${r.unknown.length ? ` (not built: ${r.unknown.join(', ')})` : ''}${r.missing.length ? ` (missed: ${r.missing.join(', ')})` : ''}${r.unexpected.length ? ` (fired: ${r.unexpected.join(', ')})` : ''}`);
  process.exitCode = results.some((r) => r.verdict === 'missed' || r.verdict === 'false-positive') ? 1 : 0;
}
