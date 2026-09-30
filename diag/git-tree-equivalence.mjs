// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether a program parses the same read out of a git revision as from that revision written to
// disk: every program's data items (size, offset, level), calls, EXEC blocks, COPY resolutions and
// diagnostics, compared with paths made relative to each tree.
//
// With --diff, whether `cobolwork diff <ref>~1 <ref>` read out of git reports what it reports with
// both revisions written to disk: findings, what the change introduced and resolved, and the
// summary's counts.
//
// usage: node diag/git-tree-equivalence.mjs [--diff] <corpus dir> [sample size] [seed] [ref]
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { gitTree, directoryTree } from '../lib/kernel/source-tree.mjs';
import { withRefs, diffRefs, diffTrees } from '../lib/diff.mjs';
import { isProgram } from '../lib/sources.mjs';

const args = process.argv.slice(2);
const diffMode = args[0] === '--diff';
const [corpus, size = '200', seed = '20260930', ref = 'HEAD'] = diffMode ? args.slice(1) : args;
if (!corpus) { console.error('usage: node diag/git-tree-equivalence.mjs [--diff] <corpus dir> [sample size] [seed] [ref]'); process.exit(2); }

let s = Number(seed) >>> 0;
const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const repos = readdirSync(corpus).filter((d) => existsSync(join(corpus, d, '.git'))).sort();
for (let i = repos.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [repos[i], repos[j]] = [repos[j], repos[i]]; }
const sample = repos.slice(0, Number(size));

// A parse result with every path made relative to its tree, so two trees rooted in different places compare.
function shape(r, rel) {
  const path = (p) => (p ? rel(p) : p);
  return JSON.stringify({
    programs: r.programs.map((p) => ({
      id: p.id,
      items: p.items.map((i) => [i.name, i.level, i.size, i.offset, path(i.file)]),
      calls: p.calls.map((c) => [c.kind, c.name]),
      execs: p.execs.map((e) => [e.kind, e.toks.length]),
    })),
    copies: r.copies.map((c) => [c.name, c.status, path(c.path)]),
    diags: r.diags.map((d) => [d.kind, d.line, path(d.file)]),
  });
}

// What a diff report says, with nothing that names where its trees were read from.
const report = (r) => JSON.stringify({
  findings: r.findings.map((f) => [f.rule, f.path, f.program, f.detail]),
  introduced: r.introduced.map((f) => [f.rule, f.path, f.fingerprint]).sort(),
  resolved: r.resolved.map((f) => [f.rule, f.path, f.fingerprint]).sort(),
  summary: { ...r.summary, base: null, head: null },
});

// A shared clone of `repo` with one more commit, which widens the first PIC X(n) in its first
// copybook by a byte: the change diff exists to follow. Null where there is no such copybook.
function withEdit(repo) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-gte-'));
  const run = (args) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8' });
  if (spawnSync('git', ['clone', '-q', '--shared', repo, dir]).status !== 0) { rmSync(dir, { recursive: true, force: true }); return null; }
  const listed = run(['ls-files', '-z']).stdout.split('\0').filter((p) => /\.(cpy|copy)$/i.test(p)).sort();
  for (const p of listed) {
    const file = join(dir, p);
    const text = readFileSync(file, 'latin1');
    const edited = text.replace(/PIC(?:TURE)?\s+X\((\d+)\)/i, (m, n) => m.replace(`(${n})`, `(${Number(n) + 1})`));
    if (edited === text) continue;
    writeFileSync(file, edited, 'latin1');
    run(['-c', 'user.email=t@example.com', '-c', 'user.name=t', 'commit', '-qam', 'widen']);
    return { dir, copybook: p };
  }
  rmSync(dir, { recursive: true, force: true });
  return null;
}

if (diffMode) {
  const tally = { repos: 0, same: 0, differ: 0, noCopybook: 0, withFindings: 0, skipped: [] };
  const differences = [];
  for (const repo of sample) {
    const edit = withEdit(join(corpus, repo));
    if (!edit) { tally.noCopybook++; continue; }
    let a, b;
    try {
      const fromGit = diffRefs(edit.dir, `${ref}~1`, ref);
      if (fromGit.findings.length) tally.withFindings++;
      a = report(fromGit);
      b = report(withRefs(edit.dir, `${ref}~1`, ref, {}, (baseDir, headDir, scoped) => diffTrees(baseDir, headDir, scoped)));
    } catch (e) { tally.skipped.push(`${repo}: ${e.code || e.message}`); continue; } finally { rmSync(edit.dir, { recursive: true, force: true }); }
    tally.repos++;
    if (a === b) { tally.same++; continue; }
    tally.differ++;
    let k = 0;
    while (k < a.length && a[k] === b[k]) k++;
    if (differences.length < 20) differences.push({ repo, at: k, git: a.slice(Math.max(0, k - 150), k + 200), disk: b.slice(Math.max(0, k - 150), k + 200) });
  }
  console.log(JSON.stringify({ corpus, ref, seed: Number(seed), sampled: sample.length, ...tally, skipped: tally.skipped.slice(0, 20), differences }, null, 1));
  process.exit(tally.differ ? 1 : 0);
}

const tally = { repos: 0, programs: 0, same: 0, differ: 0, bothThrew: 0, threwOnce: 0, skipped: [] };
const differences = [];
for (const repo of sample) {
  const at = join(corpus, repo);
  let git;
  try { git = gitTree(at, ref); } catch (e) { tally.skipped.push(`${repo}: ${e.code || e.message}`); continue; }
  try {
    withRefs(at, ref, ref, {}, (dir) => {
      const disk = directoryTree(dir);
      const onDisk = new Map(disk.list().filter(isProgram).map((p) => [disk.rel(p), p]));
      tally.repos++;
      for (const p of git.list().filter(isProgram)) {
        const rel = git.rel(p);
        const d = onDisk.get(rel);
        if (!d) continue;
        tally.programs++;
        let a, b;
        try { a = shape(git.parse(p), git.rel); } catch (e) { a = `threw ${e.code || e.name}`; }
        try { b = shape(disk.parse(d), disk.rel); } catch (e) { b = `threw ${e.code || e.name}`; }
        if (a === b) { tally.same++; if (a.startsWith('threw')) tally.bothThrew++; continue; }
        if (a.startsWith('threw') !== b.startsWith('threw')) tally.threwOnce++;
        tally.differ++;
        let k = 0;
        while (k < a.length && a[k] === b[k]) k++;
        if (differences.length < 20) differences.push({ repo, file: rel, at: k, git: a.slice(Math.max(0, k - 120), k + 180), disk: b.slice(Math.max(0, k - 120), k + 180) });
      }
    });
  } catch (e) { tally.skipped.push(`${repo}: ${e.code || e.message}`); }
}
console.log(JSON.stringify({ corpus, ref, seed: Number(seed), sampled: sample.length, ...tally, skipped: tally.skipped.slice(0, 20), differences }, null, 1));
process.exitCode = tally.differ ? 1 : 0;
