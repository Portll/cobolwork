// SPDX-License-Identifier: AGPL-3.0-or-later
// Records, beside each locator fixture in bench/hlasm-locate, the locations and lengths z390 gives
// it, as <name>.json, for test/hlasm-locate-fixtures.test.mjs to check the locator against without
// z390. Only values the oracle grades are kept, relative to their section. An EQU's length is left
// out, since z390 does not follow HLASM's leftmost-term rule for it.
//   Z390=/path/to/z390 node diag/hlasm-locate-expect.mjs [dir]
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readHlasmStatements } from '../lib/hlasm/read.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2] || join(here, '..', 'bench', 'hlasm-locate');
const tmp = mkdtempSync(join(tmpdir(), 'cw-locate-expect-'));
mkdirSync(join(tmp, 'fix', 'case'), { recursive: true });
mkdirSync(join(tmp, 'members', 'case'), { recursive: true });
const fixtures = readdirSync(dir).filter((f) => f.endsWith('.asm'));
for (const f of fixtures) copyFileSync(join(dir, f), join(tmp, 'fix', 'case', f));
const run = spawnSync(process.execPath, [join(here, 'hlasm-oracle.mjs'), tmp, join(tmp, 'oracle'), '--split', 'fix', '--force'], { encoding: 'utf8' });
if (run.status !== 0) { console.error(run.stdout, run.stderr); process.exit(1); }

const section = (name) => (name === '$PRIVATE' ? '' : name);
for (const file of readdirSync(join(tmp, 'oracle'))) {
  const o = JSON.parse(readFileSync(join(tmp, 'oracle', file), 'utf8'));
  const name = basename(o.file);
  if (!o.graded) { console.error(`${name}: not graded by z390 (${o.why})`); continue; }
  const text = readFileSync(join(dir, name), 'latin1');
  const equ = new Set(readHlasmStatements(text).statements.filter((s) => s.operation === 'EQU').map((s) => s.line));
  const origin = new Map(o.symbols.filter((y) => y.type === 'CST' || y.type === 'DST').map((y) => [section(y.name), y.type === 'DST' ? 0 : y.loc]));
  const symbols = {};
  for (const y of o.symbols) {
    if (!y.stable || y.line == null || ['CST', 'DST', 'EXT', 'WXT'].includes(y.type)) continue;
    symbols[y.name] = { section: y.type === 'ABS' ? null : section(y.section), loc: y.type === 'ABS' ? y.loc : y.loc - (origin.get(section(y.section)) ?? 0), len: equ.has(y.line) ? null : y.len, type: y.type };
  }
  const expected = { z390: o.z390, symbols, instructions: Object.fromEntries(o.statements.filter((s) => s.instruction && s.objLen != null).map((s) => [s.line, s.objLen])) };
  writeFileSync(join(dir, name.replace(/\.asm$/, '.json')), `${JSON.stringify(expected, null, 1)}\n`);
  console.log(`${name}: ${Object.keys(symbols).length} symbols`);
}
rmSync(tmp, { recursive: true, force: true });
