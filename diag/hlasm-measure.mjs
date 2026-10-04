// How lib/hlasm.mjs reads a corpus's assembler: what each file is, how many statements the cards
// fold into, the card errors, and the operations the table names, by class and by repository.
//   node diag/hlasm-measure.mjs <file-list> [--repo-depth N] [--json]
// The file list holds one path a line, as `find ... -iname '*.asm'` writes it.
import { readFileSync } from 'node:fs';
import { readHlasm } from '../lib/hlasm.mjs';

const args = process.argv.slice(2);
const depth = args.includes('--repo-depth') ? Number(args[args.indexOf('--repo-depth') + 1]) : 5;
const files = readFileSync(args[0], 'utf8').split('\n').filter(Boolean);

const kinds = {};
const repos = {};
const byClass = {};
const stateChanges = [];
const errored = [];
let statements = 0;
let errors = 0;
let defines = 0;
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'latin1'); } catch { kinds.unreadable = (kinds.unreadable || 0) + 1; continue; }
  const r = readHlasm(text);
  kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  if (r.kind !== 'hlasm') continue;
  const repo = f.split('/').slice(0, depth + 1).join('/');
  (repos[repo] ||= { files: 0, operations: 0 }).files++;
  statements += r.statements;
  defines += r.defines.length;
  const errs = r.diags.filter((d) => d.sev === 'error');
  errors += errs.length;
  if (errs.length) errored.push({ file: f, errors: errs.length, first: errs[0] });
  for (const o of r.operations) {
    byClass[o.class] = (byClass[o.class] || 0) + 1;
    repos[repo].operations++;
    if (o.stateChange) stateChanges.push(`${f}:${o.line} MODESET ${o.stateChange}${o.inMacro ? ' (macro)' : ''}`);
  }
}

const out = { files: files.length, kinds, statements, errors, filesWithErrors: errored.length, defines, byClass, repos: Object.keys(repos).length, stateChanges, errored: errored.slice(0, 20) };
if (args.includes('--json')) console.log(JSON.stringify(out, null, 1));
else {
  console.log(`files ${out.files}: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`assembler: ${statements} statements in ${out.repos} repositories, ${defines} sections and entries, ${errors} card errors in ${errored.length} files`);
  console.log(`operations: ${Object.entries(byClass).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  console.log(`state changes: ${stateChanges.length}`);
  for (const s of stateChanges.slice(0, 10)) console.log(`  ${s}`);
  for (const e of errored.slice(0, 10)) console.log(`  ${e.file}: ${e.errors} errors, first line ${e.first.line}: ${e.first.text}`);
}
