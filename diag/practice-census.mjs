// Runs the practice set over every repository of the corpora and tallies its findings per rule, the
// programs read and the programs it could not decide, so a rule's prevalence is measured rather
// than guessed. Findings are candidates until read: --show prints a sample with its source lines.
//   node diag/practice-census.mjs [--corpus dir]... [--jobs n] [--limit n] [--out file]
//                                 [--show <rule> <n>]... [--agree] [--from <an earlier --out file>]
//
// The sample is the n findings of a rule with the smallest hash of repository, path and line, so
// two runs show the same ones and shards merge without holding every finding. --agree checks the
// dead-code verdicts against lib/control.mjs's graph wherever it decides reach: a statement it
// reaches inside a paragraph the set calls dead is a disagreement, as is a statement it leaves
// unreached inside a paragraph the set calls reached.
import { readdirSync, readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { directoryTree } from '../lib/kernel/source-tree.mjs';
import { eachWithinMemory } from '../lib/kernel/memory.mjs';
import { isProgram } from '../lib/sources.mjs';
import { scanPractice, PRACTICE_RULES } from '../lib/sets/practice.mjs';
import { reachOf } from '../lib/practice-reach.mjs';
import { buildControl, namesOf } from '../lib/control.mjs';

const DEFAULT_CORPORA = ['/Users/portll/Repositories/3185RecentCobolRepos', '/Users/portll/Repositories/500RandomCobolRepos'];
const SAMPLE_KEEP = 40;

function args(argv) {
  const o = { corpora: [], jobs: 6, limit: Infinity, out: null, show: [], agree: false, shard: null, from: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') o.corpora.push(resolve(argv[++i]));
    else if (a === '--jobs') o.jobs = Number(argv[++i]);
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--out') o.out = argv[++i];
    else if (a === '--show') o.show.push({ rule: argv[++i], n: Number(argv[++i]) });
    else if (a === '--agree') o.agree = true;
    else if (a === '--shard') o.shard = argv[++i];
    else if (a === '--from') o.from = argv[++i];
    else if (a === '--agree-kind') o.agreeKind = argv[++i];
    else { process.stderr.write(`practice-census: unknown argument ${a}\n`); process.exit(2); }
  }
  if (!o.corpora.length) o.corpora = DEFAULT_CORPORA.filter((d) => existsSync(d));
  return o;
}

const rank = (s) => createHash('sha256').update(s).digest('hex');

function reposOf(corpora, limit) {
  const out = [];
  for (const c of corpora) for (const d of readdirSync(c).sort()) {
    const p = join(c, d);
    try { if (statSync(p).isDirectory()) out.push(p); } catch { /* gone since listing */ }
  }
  return out.slice(0, limit);
}

// Statements lib/control.mjs reaches inside paragraphs the walk calls dead, and the reverse.
const sampled = new Set();
function agreement(repo, tree, tally, samples) {
  const keep = (x) => { if (!sampled.has(x.k)) { sampled.add(x.k); samples.push(x); } };
  for (const f of tree.list().filter(isProgram)) {
    let r;
    try { r = tree.parse(f, tree.text(f).text); } catch { continue; }
    for (const p of r.programs) {
      if (!p.proc || !p.id) continue;
      const dataNames = new Set(p.items.flatMap((it) => [it.name, ...(it.indexNames || [])]));
      const mine = reachOf(p, (n) => dataNames.has(n));
      if (mine.undecided) { tally.mineUndecided++; continue; }
      let ctl;
      try { ctl = buildControl(p, namesOf(p).resolve); } catch { tally.controlThrew++; continue; }
      if (!ctl || !ctl.reached || ctl.partial) { tally.controlUndecided++; continue; }
      tally.programsCompared++;
      const ownerIn = (paras) => (at) => { let k = 0; for (let i = 0; i < paras.length; i++) if (paras[i].at <= at) k = i; else break; return paras[k]; };
      const owner = ownerIn(mine.paras);
      // control.mjs lets a CICS RETURN or XCTL carry on wherever HANDLE CONDITION is used; the set reads it as leaving.
      const handled = p.execs.some((e) => e.kind === 'CICS' && /^HANDLE CONDITION/.test(e.toks.filter((t) => t.t === 'word').slice(0, 2).map((t) => t.u).join(' ')));
      for (const st of p.statements) {
        if (st.at == null || st.verb === 'WHEN') continue;
        const id = ctl.nodeOf.get(st);
        if (id == null) continue;
        const para = owner(st.at);
        const theirs = !!ctl.reached[id];
        tally.statementsCompared++;
        if (!para.reached && theirs) {
          const own = para.file === f;
          if (!own) tally.deadButReachedInCopybooks++; else if (handled) tally.deadButReachedUnderHandleCondition++; else tally.deadButReached++;
          keep({ k: rank(`${repo}|${st.file}|${st.line}`), kind: !own ? 'set dead in a copybook, control reached' : handled ? 'set dead under HANDLE CONDITION, control reached' : 'set dead, control reached', repo, file: st.file, line: st.line, para: para.name, program: f });
        } else if (para.reached && !theirs) {
          tally.reachedButDead++;
          keep({ k: rank(`${repo}|${st.file}|${st.line}`), kind: 'set reached, control dead', repo, file: st.file, line: st.line, para: para.name, program: f });
        }
      }
    }
    r = null;
  }
}

function runShard(o) {
  const [k, n] = o.shard.split('/').map(Number);
  const repos = reposOf(o.corpora, o.limit).filter((_, i) => i % n === k);
  const acc = { repos: 0, reposWithPrograms: 0, reposIncomplete: 0, programsRead: 0, programsUndecided: 0, filesScanned: 0, filesUnparsed: 0, paragraphsRead: 0, recordsRead: 0,
    byRule: {}, reposByRule: {}, because: {}, samples: {}, agree: { programsCompared: 0, statementsCompared: 0, deadButReached: 0, deadButReachedInCopybooks: 0, deadButReachedUnderHandleCondition: 0, reachedButDead: 0, mineUndecided: 0, controlUndecided: 0, controlThrew: 0 }, agreeSamples: [], failed: [] };
  const run = eachWithinMemory(repos, (repo) => {
    acc.repos++;
    let out;
    const tree = directoryTree(repo);
    try { out = scanPractice(repo, { tree }); } catch (e) { acc.failed.push(`${repo}: ${e.code || e.message}`); return 0; }
    const s = out.summary;
    if (s.programsRead) acc.reposWithPrograms++;
    if (s.coverageIncomplete) acc.reposIncomplete++;
    for (const key of ['programsRead', 'programsUndecided', 'filesScanned', 'filesUnparsed', 'paragraphsRead', 'recordsRead']) acc[key] += s[key] || 0;
    for (const [why, c] of Object.entries(s.undecidedBecause || {})) acc.because[why] = (acc.because[why] || 0) + c;
    for (const [rule, c] of Object.entries(s.byRule)) { acc.byRule[rule] = (acc.byRule[rule] || 0) + c; acc.reposByRule[rule] = (acc.reposByRule[rule] || 0) + 1; }
    for (const f of out.findings) {
      const keep = (acc.samples[f.rule] ||= []);
      keep.push({ k: rank(`${repo}|${f.path}|${f.line}|${f.item}`), repo, path: f.path, line: f.line, detail: f.detail });
      if (keep.length > SAMPLE_KEEP * 4) { keep.sort((a, b) => (a.k < b.k ? -1 : 1)); keep.length = SAMPLE_KEEP; }
    }
    if (o.agree) {
      agreement(repo, tree, acc.agree, acc.agreeSamples);
      if (acc.agreeSamples.length > SAMPLE_KEEP * 4) { acc.agreeSamples.sort((a, b) => (a.k < b.k ? -1 : 1)); acc.agreeSamples.length = SAMPLE_KEEP; }
    }
    return 0;
  }, { label: 'practice-census', every: 1 });
  acc.notRead = run.skipped.length;
  acc.stoppedBy = run.stoppedBy;
  for (const keep of Object.values(acc.samples)) { keep.sort((a, b) => (a.k < b.k ? -1 : 1)); keep.length = Math.min(keep.length, SAMPLE_KEEP); }
  return acc;
}

function merge(parts) {
  const sum = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = (a[k] || 0) + v; return a; };
  const out = { repos: 0, reposWithPrograms: 0, reposIncomplete: 0, programsRead: 0, programsUndecided: 0, filesScanned: 0, filesUnparsed: 0, paragraphsRead: 0, recordsRead: 0, notRead: 0,
    byRule: {}, reposByRule: {}, because: {}, samples: {}, agree: {}, agreeSamples: [], failed: [], stoppedBy: [] };
  for (const p of parts) {
    for (const k of ['repos', 'reposWithPrograms', 'reposIncomplete', 'programsRead', 'programsUndecided', 'filesScanned', 'filesUnparsed', 'paragraphsRead', 'recordsRead', 'notRead']) out[k] += p[k] || 0;
    sum(out.byRule, p.byRule); sum(out.reposByRule, p.reposByRule); sum(out.because, p.because); sum(out.agree, p.agree);
    for (const [rule, keep] of Object.entries(p.samples)) (out.samples[rule] ||= []).push(...keep);
    out.agreeSamples.push(...p.agreeSamples);
    out.failed.push(...p.failed);
    if (p.stoppedBy) out.stoppedBy.push(p.stoppedBy);
  }
  for (const keep of Object.values(out.samples)) keep.sort((a, b) => (a.k < b.k ? -1 : 1));
  out.agreeSamples.sort((a, b) => (a.k < b.k ? -1 : 1));
  return out;
}

function sourceLines(file, line, around = 1) {
  let text;
  try { text = readFileSync(file, 'latin1').split(/\r?\n/); } catch { return ['    (unreadable)']; }
  const out = [];
  for (let i = Math.max(1, line - around); i <= Math.min(text.length, line + around); i++) out.push(`  ${i === line ? '>' : ' '} ${String(i).padStart(5)} ${text[i - 1]}`);
  return out;
}

function print(o, total) {
  const w = (s) => process.stdout.write(`${s}\n`);
  w(`repositories ${total.repos} (with programs ${total.reposWithPrograms}, incomplete ${total.reposIncomplete}, not read ${total.notRead}${total.stoppedBy.length ? `, stopped by ${[...new Set(total.stoppedBy)].join(', ')}` : ''})`);
  w(`programs read ${total.programsRead}, undecided for dead code or unused data ${total.programsUndecided}; files ${total.filesScanned}, unparsed ${total.filesUnparsed}; paragraphs ${total.paragraphsRead}; records ${total.recordsRead}`);
  w('findings by rule (repositories):');
  for (const id of Object.keys(PRACTICE_RULES)) w(`  ${id.padEnd(36)} ${String(total.byRule[id] || 0).padStart(8)}  (${total.reposByRule[id] || 0})`);
  w('undecided because:');
  for (const [why, c] of Object.entries(total.because).sort((a, b) => b[1] - a[1]).slice(0, 15)) w(`  ${String(c).padStart(7)}  ${why}`);
  if (o.agree) {
    w(`agreement with lib/control.mjs: ${JSON.stringify(total.agree)}`);
    for (const s of total.agreeSamples.filter((x) => !o.agreeKind || x.kind === o.agreeKind).slice(0, 20)) { w(`- ${s.kind}: ${s.file}:${s.line} (paragraph ${s.para}, program ${s.program})`); for (const l of sourceLines(s.file, s.line, 0)) w(l); }
  }
  if (total.failed.length) w(`failed: ${total.failed.length}\n  ${total.failed.slice(0, 10).join('\n  ')}`);
  for (const { rule, n } of o.show) {
    w(`\n== ${rule}: ${n} of ${total.byRule[rule] || 0}`);
    for (const s of (total.samples[rule] || []).slice(0, n)) {
      w(`- ${s.repo.split('/').pop()}/${s.path}:${s.line}  ${s.detail}`);
      for (const l of sourceLines(join(s.repo, s.path), s.line)) w(l);
    }
  }
}

const o = args(process.argv.slice(2));
if (o.shard) {
  process.send(runShard(o));
} else if (o.from) {
  print(o, JSON.parse(readFileSync(o.from, 'utf8')));
} else {
  const self = fileURLToPath(import.meta.url);
  const rest = process.argv.slice(2).filter((a, i, all) => !['--jobs', '--out'].includes(a) && !['--jobs', '--out'].includes(all[i - 1]));
  const parts = await Promise.all(Array.from({ length: o.jobs }, (_, k) => new Promise((done, fail) => {
    const child = fork(self, [...rest, '--shard', `${k}/${o.jobs}`], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    let got = null;
    child.on('message', (m) => { got = m; });
    child.on('exit', (code) => (got ? done(got) : fail(new Error(`shard ${k} exited ${code}`))));
  })));
  const total = merge(parts);
  if (o.out) writeFileSync(o.out, JSON.stringify(total, null, 1));
  print(o, total);
}
