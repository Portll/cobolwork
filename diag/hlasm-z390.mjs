// Assembles a corpus's HLASM with z390, which language-coverage.md phase 4 takes as its oracle: each
// file lib/hlasm.mjs reads as assembler, other than a macro definition, is assembled with z390's own
// macro library and its repository's members (staged as NAME.MAC and NAME.CPY, the names z390
// looks for). The count says how much of what the reader reads is real HLASM by an assembler's
// account, and why the rest is not.
//   Z390=/path/to/z390 node diag/hlasm-z390.mjs <file-list> [--jobs N] [--json]
import { readFileSync, mkdirSync, mkdtempSync, copyFileSync, readdirSync, statSync, rmSync, existsSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { readHlasm } from '../lib/hlasm.mjs';
import { HLASM_EXT, COPY_EXT } from '../lib/sources.mjs';

const args = process.argv.slice(2);
const Z390 = process.env.Z390;
if (!Z390 || !existsSync(join(Z390, 'z390.jar'))) { console.error('set Z390 to an unpacked z390 release'); process.exit(2); }
const jobs = args.includes('--jobs') ? Number(args[args.indexOf('--jobs') + 1]) : 4;
const files = readFileSync(args[0], 'utf8').split('\n').filter(Boolean);
const repoOf = (f) => f.split('/').slice(0, 6).join('/');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === '.git') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile()) out.push(p);
  }
  return out;
}

// One library per repository: every assembler and copy member, under the names z390 searches.
const libraries = new Map();
function library(repo, scratch) {
  if (libraries.has(repo)) return libraries.get(repo);
  const lib = join(scratch, `lib-${libraries.size}`);
  mkdirSync(lib);
  const members = [...HLASM_EXT, ...COPY_EXT];
  for (const f of walk(repo)) {
    if (!members.includes(extname(f).toLowerCase()) || statSync(f).size > 4e6) continue;
    const name = basename(f, extname(f)).toUpperCase();
    if (!/^[A-Z$#@][A-Z0-9$#@_]{0,62}$/.test(name)) continue;
    copyFileSync(f, join(lib, `${name}.MAC`));
    copyFileSync(f, join(lib, `${name}.CPY`));
  }
  libraries.set(repo, lib);
  return lib;
}

function assemble(file, lib, scratch, n) {
  return new Promise((done) => {
    const dir = join(scratch, `job-${n}`);
    mkdirSync(dir);
    const name = basename(file, extname(file)).toUpperCase().replace(/[^A-Z0-9$#@]/g, '').slice(0, 8) || 'SOURCE';
    copyFileSync(file, join(dir, `${name}.MLC`));
    const child = spawn('java', ['-classpath', join(Z390, 'z390.jar'), '-Xrs', '-Xmx150000K', 'mz390', `${name}.MLC`,
      `sysmac(+${join(Z390, 'mac')}+${lib})`, `syscpy(+${join(Z390, 'mac')}+${lib})`], { cwd: dir });
    let out = '';
    child.stdout.on('data', (b) => { out += b; });
    child.stderr.on('data', (b) => { out += b; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 60000);
    child.on('close', (rc) => {
      clearTimeout(timer);
      const sum = (what) => Number((new RegExp(`ERRSUM total ${what}\\s*=\\s*(\\d+)`).exec(out) || [])[1] || 0);
      const missing = [...out.matchAll(/missing (?:macro|copy)\s*=\s*(\S+)/g)].map((m) => m[1]);
      rmSync(dir, { recursive: true, force: true });
      done({ file, rc: rc ?? -1, missingMacros: sum('missing\\s+macro\\s+files'), undefinedSymbols: sum('undefined symbols'), missing: [...new Set(missing)] });
    });
  });
}

const scratch = mkdtempSync(join(tmpdir(), 'cw-z390-'));
const work = [];
const kinds = {};
for (const f of files) {
  let text;
  try { text = readFileSync(f, 'latin1'); } catch { continue; }
  const r = readHlasm(text);
  kinds[r.kind] = (kinds[r.kind] || 0) + 1;
  if (r.kind !== 'hlasm') continue;
  if (/^\s*MACRO\b/m.test(text.split('\n').find((l) => l.trim() && !/^\*|^\.\*/.test(l)) || '')) { kinds.macroDefinition = (kinds.macroDefinition || 0) + 1; continue; }
  work.push(f);
}

const results = [];
let next = 0;
async function worker() {
  while (next < work.length) {
    const i = next++;
    results.push(await assemble(work[i], library(repoOf(work[i]), scratch), scratch, i));
  }
}
await Promise.all(Array.from({ length: jobs }, worker));
rmSync(scratch, { recursive: true, force: true });

const byRc = {};
for (const r of results) byRc[r.rc] = (byRc[r.rc] || 0) + 1;
const assembled = results.filter((r) => r.rc === 0 || r.rc === 4);
const refused = results.filter((r) => !(r.rc === 0 || r.rc === 4));
const missingCounts = {};
for (const r of refused) for (const m of r.missing) missingCounts[m] = (missingCounts[m] || 0) + 1;
const out = {
  z390: basename(Z390), kinds, attempted: results.length, assembled: assembled.length, refused: refused.length, byRc,
  refusedForMissingMembers: refused.filter((r) => r.missing.length).length,
  commonestMissing: Object.entries(missingCounts).sort((a, b) => b[1] - a[1]).slice(0, 15),
  assembledRepos: new Set(assembled.map((r) => repoOf(r.file))).size,
};
if (args.includes('--json')) console.log(JSON.stringify({ ...out, results }, null, 1));
else console.log(JSON.stringify(out, null, 1));
