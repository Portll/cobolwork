// SPDX-License-Identifier: AGPL-3.0-or-later
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { git, revisionBlobs, treeOf, treePathParts } from './kernel/git.mjs';
import { inScope, isProgram } from './sources.mjs';
import { scanAll } from './scan.mjs';
import { FLOW_MODEL, SCHEMA_VERSION, TOOL_VERSION } from './version.mjs';
// A diff finding is located by program rather than by line, so it orders on its own key. The text
// comparison underneath it is the shared one.
import { byText, evidenceMap } from './kernel/findings.mjs';
import { directoryTree, gitTree, pdsExportRevision, pdsExportTree } from './kernel/source-tree.mjs';
import { printable } from './kernel/printable.mjs';
import { loadSite, SITE_FILE } from './site.mjs';
import { loadBaseline, BASELINE_FILE, SUPPRESSING } from './baseline.mjs';

// What a change REACHES, not what it edits. A one-line copybook edit rewrites the record layout of
// every program that COPYs it while leaving each of those programs' own source untouched, so a
// reviewer reading the diff sees one file and ships forty. This compares the two trees the way the
// compiler would see them: per program, every field's size and offset, every call and transfer
// target, and every security finding.
export const DIFF_RULES = {
  'diff-interface-layout-changed': { sev: 'high', evidence: 'change', cwe: 'CWE-1284', text: 'A record this program passes to or receives from another program changed size or position' },
  'diff-layout-changed-unedited-program': { sev: 'med', evidence: 'change', cwe: 'CWE-1284', text: 'Fields in this program changed size or position although its own source did not change' },
  'diff-layout-changed': { sev: 'low', evidence: 'change', cwe: 'CWE-1284', text: 'Fields in this program changed size or position' },
  'diff-new-dynamic-call': { sev: 'high', evidence: 'change', cwe: 'CWE-470', text: 'The change adds a call or transfer whose target is a variable' },
  'diff-new-call-target': { sev: 'med', evidence: 'change', cwe: 'CWE-470', text: 'The change makes this program call or transfer to a program it did not before' },
};

const MAX_LISTED = 8;

// The revision as committed, written into a temporary directory, for a caller that hands the tree
// to a program outside this process: build's compiler and ironwork read files, not blobs.
function materialise(repo, ref) {
  const { blobs } = revisionBlobs(repo, treeOf(repo, ref), ref);
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cobolwork-diff-')));
  try {
    for (const b of blobs) {
      const parts = treePathParts(b.path);
      if (!parts) continue;
      const to = resolve(dir, ...parts);
      mkdirSync(dirname(to), { recursive: true });
      writeFileSync(to, b.bytes);
    }
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  return dir;
}

// Whether two revisions of one file say the same thing. Compared as raw bytes instead, a program
// nobody edited reads as edited whenever the two sides were written under different line-ending
// rules: on Windows git checks the base out through core.autocrlf as CRLF while the working tree
// under review is already CRLF, or the reverse once a revision is materialised. Pinning the
// checkout would only move the mismatch to the other side, so the comparison forgives the one
// difference a checkout can introduce, and nothing else: whitespace a person actually typed
// still counts as an edit, on every platform.
const norm = (t) => t.split('\r\n').join('\n');
const sameSource = (a, b) => norm(a) === norm(b);

const qualified = (it) => { const names = []; for (let x = it; x; x = x.parent) names.unshift(x.name); return names.join('.'); };

// A program that cannot be read or parsed is named in `unread`, never dropped: dropped, it would
// read as removed from the tree, and every change inside it would go unreported.
function facts(side, opts = {}) {
  // Each side of a diff is its own tree: a revision read out of git, or the working tree, and they
  // are walked separately.
  //
  // This used to build its own parse options with systemDirs: [], where every other caller passed
  // the caller's. Nobody decided that - it is what five copies of one object literal do. The
  // consequence was that diff could not resolve a system copybook that scan could, so a layout
  // change inside one was invisible to the command whose whole job is what a change reaches. Both
  // sides now take the same configuration, which for a caller that passes no systemDirs is
  // exactly the old behaviour.
  const tree = side.tree || directoryTree(side.root, opts);
  const rel = (p) => tree.rel(p);
  const out = new Map();
  out.unread = [];
  for (const f of tree.list().filter(isProgram).filter(inScope(opts))) {
    let src;
    try { src = tree.text(f).text; } catch (e) { out.unread.push(`${rel(f)}: ${e.code || e.name}`); continue; }
    if (!/PROCEDURE\s+DIVISION|PROGRAM-ID/i.test(src)) continue;
    let r;
    try {
      r = tree.parse(f, src);
    } catch (e) { out.unread.push(`${rel(f)}: ${e.code || e.name}`); continue; }
    const file = rel(f);
    for (const p of r.programs) {
      const items = new Map();
      for (const it of p.items) {
        if (!it.name || it.name === 'FILLER' || it.level === 88 || it.level === 66 || it.level === 78) continue;
        items.set(qualified(it), { size: it.size, offset: it.offset, from: it.file ? rel(it.file) : file, section: it.section, level: it.level });
      }
      const calls = new Set();
      const dynamic = new Set();
      for (const c of p.calls) (c.kind === 'L' ? calls : dynamic).add(c.kind === 'L' ? String(c.name).toUpperCase() : `CALL ${c.name}`);
      const commareas = new Set();
      for (const e of p.execs) {
        if (e.kind !== 'CICS') continue;
        const words = e.toks.filter(t => t.t === 'word').map(t => t.u);
        if (words[0] === 'RETURN') { const rc = e.toks.findIndex(t => t.t === 'word' && t.u === 'COMMAREA'); const ra = rc >= 0 ? e.toks.slice(rc + 1).find(t => t.t === 'word') : null; if (ra) commareas.add(ra.u); continue; }
        if (!['LINK', 'XCTL', 'START'].includes(words[0])) continue;
        const at = e.toks.findIndex(t => t.t === 'word' && (t.u === 'PROGRAM' || t.u === 'TRANSID'));
        const target = at >= 0 ? e.toks.slice(at + 1).find(t => t.t === 'lit' || t.t === 'word') : null;
        if (target && target.t === 'lit') calls.add(String(target.v).trim().toUpperCase());
        else if (target) dynamic.add(`EXEC CICS ${words[0]} ${target.u}`);
        const ca = e.toks.findIndex(t => t.t === 'word' && t.u === 'COMMAREA');
        const arg = ca >= 0 ? e.toks.slice(ca + 1).find(t => t.t === 'word') : null;
        if (arg) commareas.add(arg.u);
      }
      const using = new Set(p.calls.flatMap(c => c.using.filter(a => a.word).map(a => a.word)));
      const copied = new Set(r.copies.filter((c) => c.status === 'resolved' && c.path).map((c) => rel(c.path)));
      out.set(`${file}#${p.id}`, { id: p.id, file, text: src, items, calls, dynamic, commareas, using, copied });
    }
  }
  return out;
}

// The key a finding keeps across two trees: its fingerprint, which never includes its line. The
// fallback, for a report stamped by nothing, is the coarser key this used before there was one:
// under it, fixing one finding and adding another of the same rule in the same program read as no
// change at all.
const findingKey = (f) => f.fingerprint || [f.rule, f.path, f.program || '', f.name || ''].join('|');

function countByKey(findings) {
  const m = new Map();
  for (const f of findings) m.set(findingKey(f), (m.get(findingKey(f)) || 0) + 1);
  return m;
}

// Each side is a directory, or a source tree: a git revision read without writing it out.
const sideOf = (x) => (typeof x === 'string' ? { root: x, tree: null } : { root: x.root, tree: x });

export function diffTrees(baseSide, headSide, opts = {}) {
  const baseAt = sideOf(baseSide);
  const headAt = sideOf(headSide);
  // The allow list describes the working tree, so it never applies to a revision: applied there it
  // would match nothing and the base would read as empty.
  const baseOpts = { ...opts, allow: null };
  const base = facts(baseAt, baseOpts);
  const head = facts(headAt, opts);
  const findings = [];
  const reach = { programsCompared: 0, programsAdded: 0, programsRemoved: 0, programsWithLayoutChange: 0, reachedOnlyThroughCopybooks: 0, copybooksImplicated: new Set() };

  for (const [key, h] of head) {
    const b = base.get(key);
    if (!b) { reach.programsAdded++; continue; }
    reach.programsCompared++;
    const changed = [];
    for (const [name, now] of h.items) {
      const was = b.items.get(name);
      if (!was) continue;
      if (was.size !== now.size || was.offset !== now.offset) changed.push({ name, was, now });
    }
    if (changed.length) {
      reach.programsWithLayoutChange++;
      const unedited = sameSource(b.text, h.text);
      if (unedited) reach.reachedOnlyThroughCopybooks++;
      for (const c of changed) if (c.now.from !== h.file) reach.copybooksImplicated.add(c.now.from);
      // An interface record is one another program also reads: the linkage section, a CICS
      // communication area, or an argument passed on a CALL. A size change there is a mismatch
      // between two programs unless both were rebuilt against the same copybook.
      // A field inside a record passed by name crosses the boundary too, so any segment of its
      // qualified name counts, not only the record's own.
      const passed = new Set([...h.commareas, ...h.using]);
      const iface = changed.filter(c => c.now.section === 'LINKAGE' || c.name.split('.').some(seg => passed.has(seg)));
      const rule = iface.length ? 'diff-interface-layout-changed' : unedited ? 'diff-layout-changed-unedited-program' : 'diff-layout-changed';
      const listed = (iface.length ? iface : changed).slice(0, MAX_LISTED)
        .map(c => `${c.name} ${c.was.size}→${c.now.size} bytes${c.was.offset !== c.now.offset ? ` at offset ${c.was.offset}→${c.now.offset}` : ''}${c.now.from !== h.file ? ` (from ${c.now.from})` : ''}`);
      findings.push({ rule, path: h.file, line: 1, program: h.id,
        detail: `${changed.length} field(s) changed${unedited ? ' although this program\'s source is unchanged' : ''}: ${listed.join('; ')}${changed.length > MAX_LISTED ? '; …' : ''}` });
    }
    for (const d of h.dynamic) if (!b.dynamic.has(d)) findings.push({ rule: 'diff-new-dynamic-call', path: h.file, line: 1, program: h.id, detail: `${d} is new in this change` });
    const added = [...h.calls].filter(c => !b.calls.has(c));
    if (added.length) findings.push({ rule: 'diff-new-call-target', path: h.file, line: 1, program: h.id, detail: `now calls or transfers to ${added.sort().join(', ')}` });
  }
  const unreadHead = new Set(head.unread.map(u => u.split(': ')[0]));
  for (const [key, b] of base) if (!head.has(key) && !unreadHead.has(b.file)) reach.programsRemoved++;

  const listing = { listSinks: opts.listSinks === true, listSources: opts.listSources === true };
  const shared = { only: opts.only, fullTrace: opts.fullTrace, systemDirs: opts.systemDirs || [], ...listing };
  const withTree = (at) => (at.tree ? { tree: at.tree } : {});
  const before = scanAll(baseAt.root, { ...shared, ...withTree(baseAt) });
  const after = scanAll(headAt.root, { ...shared, ...withTree(headAt), allow: opts.allow });
  // A file neither tree could read cannot be compared. Its findings are neither introduced nor
  // resolved, and calling them resolved would report a scan failure as a fix.
  const unreadable = new Set([...base.unread, ...head.unread].map(u => u.split(': ')[0]));
  const comparable = (f) => !unreadable.has(f.path);
  const beforeCounts = countByKey(before.findings.filter(comparable));
  const afterCounts = countByKey(after.findings.filter(comparable));
  const seenIntroduced = new Map();
  const introduced = after.findings.filter(comparable).filter((f) => {
    const k = findingKey(f);
    const n = (seenIntroduced.get(k) || 0) + 1;
    seenIntroduced.set(k, n);
    return n > (beforeCounts.get(k) || 0);
  });
  const seenResolved = new Map();
  const resolved = before.findings.filter(comparable).filter((f) => {
    const k = findingKey(f);
    const n = (seenResolved.get(k) || 0) + 1;
    seenResolved.set(k, n);
    return n > (afterCounts.get(k) || 0);
  });
  const uncomparable = [...new Set([...before.findings, ...after.findings].filter(f => !comparable(f)).map(f => f.path))];
  const configurationChanged = configurationChanges(baseSide, headSide);

  for (const f of findings) { const m = DIFF_RULES[f.rule]; f.sev = m.sev; f.cwe = m.cwe; f.evidence = m.evidence; }
  findings.sort((a, b) => byText(a.rule, b.rule) || byText(a.path, b.path) || byText(String(a.program), String(b.program)));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const res = {
    tool: 'cobolwork-diff',
    schemaVersion: SCHEMA_VERSION,
    summary: {
      flowModel: FLOW_MODEL,
      toolVersion: TOOL_VERSION,
      findings: findings.length, byRule,
      introduced: introduced.length, resolved: resolved.length,
      ...reach, copybooksImplicated: [...reach.copybooksImplicated].sort(),
      unread: { base: base.unread, head: head.unread, findingsNotCompared: uncomparable },
      ...(configurationChanged.length ? { configurationChanged } : {}),
      coverageIncomplete: !!(before.summary.coverageIncomplete || after.summary.coverageIncomplete || base.unread.length || head.unread.length),
      nosrc: head.size === 0 && base.size === 0,
    },
    findings,
    introduced,
    resolved,
    ruleText: Object.fromEntries(Object.entries(DIFF_RULES).map(([k, v]) => [k, v.text])),
    ruleEvidence: evidenceMap(DIFF_RULES),
  };
  // Both scans and both sides' programs, for a caller that judges the change; never printed.
  if (opts.keepScans) Object.defineProperty(res, 'scans', { value: { before, after, base, head }, enumerable: false });
  return res;
}

// Site-file and baseline changes, which move findings between introduced and resolved with no source changed.
const SITE_LISTS = ['productionQualifiers', 'productionJobPaths', 'nonProductionJobPaths', 'systemNames', 'vendorPacks',
  'internalReaderDds', 'internalReaderQueues', 'compilerOptions', 'apfLibraries', 'restrictedDatasets', 'surrogateUsers'];

// Whether a side holds a file at its top: in the source tree it was read from, or on disk.
const holds = (at, name) => (at.tree && at.tree.kind !== 'directory' ? at.tree.contains(resolve(at.tree.root, name)) : existsSync(join(at.root, name)));

function siteChange(baseAt, headAt) {
  const was = holds(baseAt, SITE_FILE);
  const now = holds(headAt, SITE_FILE);
  if (!was && !now) return null;
  if (!now) return { file: SITE_FILE, change: 'removed, so the rules that need it do not run' };
  const b = loadSite(baseAt.root, null, baseAt.tree);
  const h = loadSite(headAt.root, null, headAt.tree);
  const parts = was ? [] : ['added'];
  for (const k of SITE_LISTS) {
    const gone = b[k].filter((x) => !h[k].includes(x)).map((x) => `-${x}`);
    const came = h[k].filter((x) => !b[k].includes(x)).map((x) => `+${x}`);
    if (gone.length || came.length) parts.push(`${k} ${[...gone, ...came].join(' ')}`);
  }
  if (b.allowUnvalidatedPacks !== h.allowUnvalidatedPacks) parts.push(`allowUnvalidatedPacks ${h.allowUnvalidatedPacks}`);
  if (JSON.stringify(b.runtimeVersions) !== JSON.stringify(h.runtimeVersions)) parts.push('runtimeVersions');
  if (h.problems.length && h.problems.join() !== b.problems.join()) parts.push(`now reports: ${h.problems[0]}`);
  return parts.length ? { file: SITE_FILE, change: printable(parts.join('; '), 400) } : null;
}

export const configurationChanges = (baseSide, headSide) => {
  const baseAt = sideOf(baseSide);
  const headAt = sideOf(headSide);
  return [siteChange(baseAt, headAt), baselineChange(baseAt, headAt)].filter(Boolean);
};

function baselineChange(baseAt, headAt) {
  const was = holds(baseAt, BASELINE_FILE);
  const now = holds(headAt, BASELINE_FILE);
  if (!was && !now) return null;
  const held = (at, there) => new Map((there ? loadBaseline(at.root, { tree: at.tree })?.entries || [] : []).map((e) => [`${e.fingerprint}|${e.rule}`, e]));
  const b = held(baseAt, was);
  const h = held(headAt, now);
  const added = [...h.keys()].filter((k) => !b.has(k));
  const suppressing = added.filter((k) => SUPPRESSING.includes(h.get(k).action)).length;
  const removed = [...b.keys()].filter((k) => !h.has(k)).length;
  const changed = [...h.keys()].filter((k) => b.has(k) && JSON.stringify(b.get(k)) !== JSON.stringify(h.get(k))).length;
  if (!added.length && !removed && !changed && was === now) return null;
  return { file: BASELINE_FILE, change: `${was ? (now ? 'edited' : 'removed') : 'added'}: ${added.length} entr${added.length === 1 ? 'y' : 'ies'} added, ${suppressing} of them suppressing; ${removed} removed; ${changed} changed` };
}

// The files git would show in a commit: tracked, plus untracked ones that are not ignored. A
// working tree also holds build output and vendored copies that no revision contains, and comparing
// those against a revision reports a change in a file nobody changed.
function gitScope(repo) {
  const r = git(repo, ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' });
  if (r.status !== 0) throw Object.assign(new Error(`git ls-files failed: ${String(r.stderr || '').trim()}`), { code: 'EDIFFREF' });
  return new Set(r.stdout.split('\0').filter(Boolean).map(p => resolve(repo, p)));
}

export const WORKING_TREE = 'working tree, tracked and untracked files git does not ignore';

// Calls fn(baseDir, headDir, opts) with both revisions on disk, the head being the working tree when
// headRef is null, and removes what it materialised however fn ends.
export function withRefs(repo, baseRef, headRef, opts, fn) {
  const baseDir = materialise(repo, baseRef);
  let headDir = null;
  try {
    headDir = headRef ? materialise(repo, headRef) : repo;
    return fn(baseDir, headDir, headRef ? opts : { ...opts, allow: gitScope(repo) });
  } finally {
    rmSync(baseDir, { recursive: true, force: true });
    if (headRef && headDir) rmSync(headDir, { recursive: true, force: true });
  }
}

// The members of a PDS export's working tree whose files git tracks or would track: an archive's
// members by the archive's file.
function exportScope(repo, tree) {
  const scope = gitScope(repo);
  return new Set(tree.list().filter((p) => scope.has(resolve(repo, tree.origin(p).replace(/\([^)]*\)$/, '')))));
}

// Reads each revision out of git without writing it anywhere; the head is the working tree when
// headRef is null. With pdsExport each side is read as a PDS export, members named for their data
// sets on both.
export function diffRefs(repo, baseRef, headRef = null, opts = {}) {
  const trees = { systemDirs: opts.systemDirs || [] };
  const revision = (ref) => (opts.pdsExport ? pdsExportRevision(repo, ref, trees) : gitTree(repo, ref, trees));
  const base = revision(baseRef);
  const head = headRef ? revision(headRef) : opts.pdsExport ? pdsExportTree(repo, trees) : repo;
  const allow = headRef ? null : opts.pdsExport ? exportScope(repo, head) : gitScope(repo);
  const res = diffTrees(base, head, allow ? { ...opts, allow } : opts);
  res.summary.base = baseRef;
  res.summary.head = headRef || WORKING_TREE;
  if (opts.pdsExport) res.summary.pdsExport = { base: base.export, head: head.export };
  return res;
}
