// Compares what ironwork refuses with what Enterprise COBOL refused, over compile listings that
// carry their source: each unit's COPY-expanded source goes through `ironwork check`, the two
// return codes are set against each other, and where both refuse, the lines of the severe
// messages are compared. A unit IBM refused only because EXEC CICS or EXEC SQL met NOCICS or
// NOSQL is counted apart: ironwork reads both without an option. A unit whose listing shows a COPY
// or INCLUDE with no expansion, and no -I directory holds the member, is counted as
// source-incomplete and sent to neither compiler.
//
//   node diag/refusals-against-ibm.mjs <listing-or-dir>... --ironwork <bin> [-I <dir>]... [--out <file>] [--samples <n>]
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { parseIbmListing, sourceText, unexpandedCopies } from './ibm-listing.mjs';

const SEVERITY_RC = { I: 0, W: 4, E: 8, S: 12, U: 16 };
const OPTION_REFUSALS = new Set(['IGYPS0228-S', 'IGYDS0225-S', 'IGYPS0225-S']);
const MESSAGE = /^(.*?):(\d+):(\d+): (IW[A-Z]\d{4}-([IWESU])) (.*)$/;

const args = process.argv.slice(2);
const bin = args[args.indexOf('--ironwork') + 1];
const includes = args.flatMap((a, i) => (a === '-I' ? [args[i + 1]] : []));
const OUT = args.includes('--out') ? args[args.indexOf('--out') + 1] : null;
const SAMPLES = args.includes('--samples') ? Number(args[args.indexOf('--samples') + 1]) : 15;
const roots = args.filter((a, i) => !a.startsWith('-') && !['--ironwork', '-I', '--out', '--samples'].includes(args[i - 1]));

function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = roots.flatMap((r) => (statSync(r).isDirectory() ? walk(r, []) : [r]));
const tmp = mkdtempSync(join(tmpdir(), 'cobolwork-refusals-'));
const total = {
  units: 0, timeouts: 0, sourceIncomplete: 0,
  matrix: { bothAccept: 0, bothRefuse: 0, bothRefuseSameLine: 0, ibmOnly: 0, ibmOnlyOption: 0, ironworkOnly: 0 },
  ironworkOnlyIds: {}, ibmOnlyIds: {},
  samples: { ironworkOnly: [], ibmOnly: [], bothRefuseOtherLine: [] },
  rows: [],
};
const sample = (kind, x) => { if (total.samples[kind].length < SAMPLES) total.samples[kind].push(x); };
const count = (map, key) => { map[key] = (map[key] ?? 0) + 1; };

let n = 0;
for (const file of files) {
  const text = readFileSync(file, 'latin1');
  if (!/PP \d{4}-[A-Z0-9]{3} IBM/.test(text)) continue;
  for (const unit of parseIbmListing(text).units) {
    if (!unit.source.length) continue;
    total.units++;
    const missing = unexpandedCopies(unit).filter((name) => !includes.some((dir) => readdirSync(dir).some((f) => f.replace(/\.[^.]+$/, '').toUpperCase() === name)));
    if (missing.length) {
      total.sourceIncomplete++;
      total.rows.push({ listing: basename(file), unit: unit.name, incomplete: missing });
      continue;
    }
    const source = join(tmp, `${unit.name || 'UNIT'}-${++n}.cbl`);
    writeFileSync(source, sourceText(unit));
    const run = spawnSync(bin, ['check', source, ...includes.flatMap((d) => ['-I', d])], { encoding: 'utf8', timeout: 30000 });
    if (run.error || run.status == null) { total.timeouts++; continue; }
    const ironwork = run.stderr.split('\n').map((l) => MESSAGE.exec(l)).filter(Boolean).map((m) => ({ line: Number(m[2]), id: m[4], severity: m[5], text: m[6] }));
    const ibm = unit.diagnostics.filter((d) => !d.inline);
    const ibmRc = Math.max(0, ...ibm.map((d) => SEVERITY_RC[d.severity]));
    const ibmRefuses = ibmRc >= 12;
    const ironworkRefuses = run.status >= 12;
    const ibmSevere = ibm.filter((d) => SEVERITY_RC[d.severity] >= 12);
    const ironworkSevere = ironwork.filter((d) => SEVERITY_RC[d.severity] >= 12);
    const row = { listing: basename(file), unit: unit.name, ibmRc, ironworkRc: run.status, ibm: ibmSevere.map((d) => `${d.line} ${d.id}`), ironwork: ironworkSevere.map((d) => `${d.line} ${d.id}`) };
    total.rows.push(row);
    if (!ibmRefuses && !ironworkRefuses) total.matrix.bothAccept++;
    else if (ibmRefuses && ironworkRefuses) {
      total.matrix.bothRefuse++;
      const lines = new Set(ibmSevere.map((d) => d.line));
      if (ironworkSevere.some((d) => lines.has(d.line))) total.matrix.bothRefuseSameLine++;
      else sample('bothRefuseOtherLine', { ...row, ibmFirst: ibmSevere[0]?.text.slice(0, 100), ironworkFirst: ironworkSevere[0]?.text.slice(0, 100) });
    } else if (ibmRefuses) {
      if (ibmSevere.every((d) => OPTION_REFUSALS.has(d.id))) total.matrix.ibmOnlyOption++;
      else {
        total.matrix.ibmOnly++;
        for (const d of ibmSevere) count(total.ibmOnlyIds, d.id);
        sample('ibmOnly', { ...row, ibmFirst: ibmSevere[0]?.text.slice(0, 100) });
      }
    } else {
      total.matrix.ironworkOnly++;
      for (const d of ironworkSevere) count(total.ironworkOnlyIds, d.id);
      sample('ironworkOnly', { ...row, ironworkFirst: ironworkSevere[0]?.text.slice(0, 100) });
    }
  }
}
rmSync(tmp, { recursive: true, force: true });

if (OUT) writeFileSync(OUT, JSON.stringify(total, null, 2) + '\n');
const m = total.matrix;
console.log(`${total.units} units with source; ${total.sourceIncomplete} source-incomplete (a COPY or INCLUDE with no expansion), left out; ${total.timeouts} timed out`);
console.log(`both accept ${m.bothAccept}; both refuse ${m.bothRefuse} (${m.bothRefuseSameLine} on a common line); IBM refuses and ironwork accepts ${m.ibmOnly} (+${m.ibmOnlyOption} for EXEC without the option); ironwork refuses and IBM accepts ${m.ironworkOnly}`);
const top = (map) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', ');
console.log(`ironwork-only ids: ${top(total.ironworkOnlyIds)}`);
console.log(`IBM-only ids: ${top(total.ibmOnlyIds)}`);
for (const kind of ['ironworkOnly', 'ibmOnly', 'bothRefuseOtherLine']) {
  if (!total.samples[kind].length) continue;
  console.log(`\n${kind}:`);
  for (const s of total.samples[kind]) console.log('  ' + JSON.stringify(s));
}
