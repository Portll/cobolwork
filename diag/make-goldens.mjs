// Regenerates the compiler-derived goldens the parser tests compare against. Run it when GnuCOBOL
// is installed; the tests themselves never need the compiler.
//   node diag/make-goldens.mjs
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseListing, looksDegenerate } from './listing.mjs';
import { factsFromListing } from './compare.mjs';
import { prepareForWitness } from './precompiler.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test', 'fixtures', 'parser');
const cases = JSON.parse(readFileSync(join(FIXTURES, 'cases.json'), 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'cobolwork-goldens-'));
let failed = 0;

for (const c of cases) {
  const lst = join(tmp, `${c.file}.lst`);
  // The compiler reads a precompiled case through the precompiler stand-in; the parser test reads the
  // file as written, which is what such a case is there to test.
  let source = c.file;
  if (c.witness === 'precompiled') {
    source = join(tmp, c.file);
    writeFileSync(source, prepareForWitness(readFileSync(join(FIXTURES, c.file), 'latin1'), c.format || 'fixed'), 'latin1');
  }
  const args = ['-fsyntax-only', '-frelax-syntax-checks', `-std=${c.std || 'default'}`, `-fformat=${c.format || 'fixed'}`,
    '-t', lst, '-Xref', '-ftsymbols', ...(c.include || []).flatMap(d => ['-I', d]), source];
  const r = spawnSync('cobc', args, { cwd: FIXTURES, encoding: 'latin1' });
  if (r.status !== 0) {
    failed++;
    console.error(`REFUSED ${c.file}: ${(r.stderr || '').split('\n').find(l => / error: /.test(l)) || `exit ${r.status}`}`);
    continue;
  }
  const listing = parseListing(readFileSync(lst, 'latin1'));
  if (looksDegenerate(listing, readFileSync(join(FIXTURES, c.file), 'latin1'))) {
    failed++;
    console.error(`DEGENERATE ${c.file}: the listing reports far fewer records than the source declares`);
    continue;
  }
  writeFileSync(join(FIXTURES, `${c.file}.golden.json`), JSON.stringify({ case: c, programs: listing.programs, witness: factsFromListing(listing) }, null, 1) + '\n');
  console.log(`${c.file}: ${listing.symbols.length} items, ${listing.labels.length} labels, ${listing.calls.length} calls`);
}
rmSync(tmp, { recursive: true, force: true });
if (failed) { console.error(`${failed} case(s) produced no golden`); process.exit(2); }
