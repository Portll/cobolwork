// Fetches a corpus of public COBOL repositories to measure rules against, and writes down exactly
// what it fetched.
//
//   node diag/fetch-corpus.mjs <dest> [--want 200] [--min-files 50] [--pushed-since 2026-08-20]
//                                     [--max-mb 500] [--jobs 6] [--dry-run]
//
// A measurement is worth what its corpus is worth, so the manifest matters as much as the clones.
// It records the query, the date, and for every repository its stars, size, push date and file
// count - including the ones that were rejected and why. "Measured over 200 repositories" is a
// claim someone will ask about, and this is the answer.
//
// Selection is by stars descending, which is a bias and is recorded as one: popular COBOL on
// GitHub is teaching material and tooling far more than it is production banking code. A rule that
// is quiet here is quiet on that population, not on an estate.
import { mkdirSync, writeFileSync, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (n, d) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : d);
const DEST = resolve(args.find((a) => !a.startsWith('--')) || 'corpus');
const WANT = Number(flag('want', 200));
const MIN_FILES = Number(flag('min-files', 50));
const SINCE = flag('pushed-since', '2026-08-20');
const MAX_MB = Number(flag('max-mb', 500));
const JOBS = Number(flag('jobs', 6));
const DRY = args.includes('--dry-run');

const QUERY = `language:cobol pushed:>${SINCE} is:public`;

function gh(path, params) {
  const a = ['api', '-X', 'GET', path];
  for (const [k, v] of Object.entries(params)) a.push('-f', `${k}=${v}`);
  return JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
}

// Count every file in the tree except the repository's own metadata. This is the criterion the
// corpus is selected on, so it is counted rather than estimated from the API's size field: a
// repository can be large because of one binary and small because of a thousand copybooks.
function countFiles(dir) {
  let n = 0;
  const walk = (d) => {
    let es;
    try { es = readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.isFile()) n++;
    }
  };
  walk(dir);
  return n;
}

console.log(`query:      ${QUERY}`);
console.log(`want:       ${WANT} repositories with more than ${MIN_FILES} files`);
console.log(`dest:       ${DEST}`);

const candidates = [];
for (let page = 1; page <= 10 && candidates.length < 1000; page++) {
  const r = gh('search/repositories', { q: QUERY, sort: 'stars', order: 'desc', per_page: '100', page: String(page) });
  if (!r.items || !r.items.length) break;
  for (const it of r.items) {
    candidates.push({
      full_name: it.full_name, stars: it.stargazers_count, size_kb: it.size,
      pushed_at: it.pushed_at, default_branch: it.default_branch,
      clone_url: it.clone_url, archived: it.archived, fork: it.fork,
    });
  }
  if (candidates.length >= (r.total_count || 0)) break;
}
console.log(`candidates: ${candidates.length} (sorted by stars, descending)\n`);

if (DRY) {
  for (const c of candidates.slice(0, 30)) console.log(`  ${String(c.stars).padStart(6)}  ${String(Math.round(c.size_kb / 1024)).padStart(5)}MB  ${c.full_name}`);
  console.log(`\n(dry run; ${candidates.length} candidates, nothing cloned)`);
  process.exit(0);
}

mkdirSync(DEST, { recursive: true });

const accepted = [];
const rejected = [];
let cursor = 0;
let active = 0;
let done = false;

const clone = (c) => new Promise((res) => {
  const dir = join(DEST, c.full_name.replace('/', '__'));
  if (existsSync(dir)) {
    const n = countFiles(dir);
    return res({ c, dir, files: n, reused: true });
  }
  const p = spawn('git', ['clone', '--depth', '1', '--single-branch', '--no-tags', '-q', c.clone_url, dir],
    { stdio: 'ignore' });
  const timer = setTimeout(() => { try { p.kill(); } catch { /* already gone */ } }, 180000);
  p.on('exit', (code) => {
    clearTimeout(timer);
    if (code !== 0) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* nothing to remove */ } return res({ c, dir, error: `clone exited ${code}` }); }
    res({ c, dir, files: countFiles(dir) });
  });
  p.on('error', (e) => { clearTimeout(timer); res({ c, dir, error: e.message }); });
});

async function pump() {
  while (!done && cursor < candidates.length && accepted.length < WANT) {
    const c = candidates[cursor++];
    if (c.archived) { rejected.push({ ...c, why: 'archived' }); continue; }
    if (c.size_kb / 1024 > MAX_MB) { rejected.push({ ...c, why: `larger than ${MAX_MB}MB` }); continue; }

    active++;
    const r = await clone(c);
    active--;

    if (r.error) { rejected.push({ ...c, why: r.error }); }
    else if (r.files <= MIN_FILES) {
      rejected.push({ ...c, files: r.files, why: `only ${r.files} files` });
      try { rmSync(r.dir, { recursive: true, force: true }); } catch { /* leave it */ }
    } else {
      accepted.push({ ...c, files: r.files, dir: r.dir.slice(DEST.length + 1) });
      if (accepted.length % 10 === 0 || accepted.length === WANT) {
        console.log(`  ${String(accepted.length).padStart(3)}/${WANT} accepted, ${rejected.length} rejected, ${cursor}/${candidates.length} considered`);
      }
    }
    if (accepted.length >= WANT) done = true;
  }
}

await Promise.all(Array.from({ length: JOBS }, () => pump()));

const manifest = {
  query: QUERY,
  fetched: new Date().toISOString().slice(0, 10),
  criteria: { want: WANT, minFiles: MIN_FILES, pushedSince: SINCE, maxMb: MAX_MB, sort: 'stars descending' },
  // The bias, written down. Popular COBOL on GitHub is teaching material and tooling far more than
  // it is production banking code, so a rule that is quiet here is quiet on that population.
  bias: 'Selected by stars descending from public repositories pushed to recently. This over-represents teaching material, compilers and tooling, and under-represents the private estates these rules are written for. A low fire rate here is evidence about open-source COBOL, not about a bank.',
  candidates: candidates.length,
  accepted: accepted.length,
  rejected: rejected.length,
  repositories: accepted,
  rejectedRepositories: rejected,
};
writeFileSync(join(DEST, 'corpus-manifest.json'), JSON.stringify(manifest, null, 1) + '\n');

console.log(`\n${accepted.length} accepted of ${candidates.length} candidates considered`);
console.log(`files: ${accepted.reduce((n, r) => n + r.files, 0)} across the corpus`);
const why = {};
for (const r of rejected) { const k = /only \d+ files/.test(r.why) ? 'too few files' : r.why; why[k] = (why[k] || 0) + 1; }
for (const [k, n] of Object.entries(why).sort((a, b) => b[1] - a[1])) console.log(`  rejected ${String(n).padStart(3)}: ${k}`);
console.log(`\nmanifest: ${join(DEST, 'corpus-manifest.json')}`);
if (accepted.length < WANT) console.log(`\nNOTE: only ${accepted.length} of the ${WANT} asked for. The pool of ${candidates.length} candidates did not hold more that met the criteria.`);
