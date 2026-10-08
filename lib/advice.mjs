// SPDX-License-Identifier: AGPL-3.0-or-later
// The advice document: one list of what a repository should remediate and which practices it misses,
// each item resting on a rule, a practice or a compiler message, with the catalogue those ids point
// into. docs/spec/advice.md is the contract; schema/cobolwork-advice.schema.json the shape.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { basename, resolve } from 'node:path';
import { REGISTRY, ALL_RULES } from './kernel/registry.mjs';
import { FINGERPRINT_VERSION } from './kernel/identity.mjs';
import { directoryTree } from './kernel/source-tree.mjs';
import { clausesFor } from './compliance.mjs';
import { availablePacks, readPack } from './packs.mjs';
import { scanAll } from './scan.mjs';
import { inventory } from './inventory.mjs';
import { applyBaseline, loadBaseline } from './baseline.mjs';
import { optionsInForce, WATCHED } from './option-diff.mjs';
import { DEFAULT_POLICY, treePolicy } from './policy.mjs';
import { isProgram, isCopybook, isJcl, isBms, isAssembler, isIms, isDb2, isPli, isSource } from './sources.mjs';
import { toolRevision } from './revision.mjs';
import { ADVICE_SCHEMA_VERSION, FLOW_MODEL, TOOL_VERSION } from './version.mjs';
import { compilerAdvice } from './advice-compiler.mjs';
import { PRACTICE_RULES, scanPractice } from './sets/practice.mjs';

const SEV_RANK = { crit: 5, high: 4, med: 3, low: 2, info: 1 };
const VERDICT_RANK = { confirmed: 7, exploitable: 6, 'attacker-driven': 5, restricted: 4, mitigated: 3, upstream: 2, refuted: 1 };
const KIND_RANK = { finding: 1, compile: 2, practice: 3, option: 4, inventory: 5 };

// What the inventory reports that a repository can act on.
export const INVENTORY_PRACTICES = {
  'inventory-missing-copybook': { class: 'estate', sev: 'med', text: 'A COPY names a member no tree or library holds', why: 'Every program that copies it is read with a hole where the member would be, so its layouts, flows and findings are incomplete', how: 'Add the copybook to the tree, or name the library that holds it with --copylib or as copylibs in cobolwork.site.json' },
  'inventory-recursive-copybook': { class: 'estate', sev: 'low', text: 'A copybook copies itself, directly or through others', why: 'No compiler expands it, so the programs that copy it do not compile as written', how: 'Break the cycle: move the shared entries into a member neither copies' },
  'inventory-unreadable-source': { class: 'estate', sev: 'low', text: 'A source file could not be read', why: 'What it holds contributes nothing to any finding, so the report is silent about it rather than clean', how: 'Fix its permissions or encoding, or remove it from the tree if it is not source' },
  'inventory-ebcdic-source': { class: 'estate', sev: 'info', text: 'A source file is stored in EBCDIC', why: 'Every tool that reads the repository as text misreads it unless told the encoding', how: 'Store source in the encoding the repository declares, or keep EBCDIC members under one directory the site file names' },
};

const groupClauses = (ruleId) => {
  const out = {};
  for (const c of clausesFor(ruleId)) (out[c.framework] ||= []).push({ clause: c.clause, ...(c.title ? { title: c.title } : {}) });
  return out;
};

const ruleEntry = (set, id, r) => ({
  id, set, sev: r.sev, evidence: r.evidence, cwe: r.cwe ?? null, text: r.text,
  impact: r.impact ?? null, remedy: r.remedy ?? null, steps: r.steps ? [...r.steps] : [], references: r.references ? [...r.references] : [],
  compliance: groupClauses(id), measured: r.measured ?? null, ...(r.whenPrivileged ? { whenPrivileged: r.whenPrivileged } : {}),
});

function packEntries() {
  const out = [];
  for (const name of availablePacks()) {
    let pack;
    try { pack = readPack(name); } catch { continue; }
    for (const r of pack.rules || []) {
      out.push({
        id: r.id, set: `pack:${name}`, sev: r.severity, evidence: r.severity === 'info' ? 'context' : 'construct', cwe: r.cwe ?? null,
        text: `${pack.vendor} ${pack.product}: ${r.verb ? `${r.verb} ` : ''}${r.risk}`, impact: r.rationale ?? null, remedy: r.remedy ?? null,
        steps: r.steps ? [...r.steps] : [], references: r.references ? [...r.references] : [], compliance: groupClauses(r.id), measured: null,
      });
    }
  }
  return out;
}

const practiceEntry = (id, p) => ({
  id, class: p.class, sev: p.sev, text: p.text, why: p.why ?? p.impact ?? null, how: p.how ?? p.remedy ?? null,
  steps: p.steps ? [...p.steps] : [], references: p.references ? [...p.references] : [], compliance: groupClauses(id), measured: p.measured ?? null,
});

export function catalogue(compilerMessages = []) {
  const setOf = new Map(REGISTRY.flatMap((s) => Object.keys(s.rules).map((id) => [id, s.name])));
  const rules = [...Object.entries(ALL_RULES).map(([id, r]) => ruleEntry(setOf.get(id), id, r)), ...packEntries()].sort((a, b) => a.id.localeCompare(b.id));
  const practices = [...Object.entries(PRACTICE_RULES), ...Object.entries(INVENTORY_PRACTICES)].map(([id, p]) => practiceEntry(id, p)).sort((a, b) => a.id.localeCompare(b.id));
  const compiler = [...compilerMessages].sort((a, b) => a.id.localeCompare(b.id));
  return { rules, practices, compiler };
}

const itemId = (kind, ref, where, detail) => `${kind}:${ref}:${createHash('sha256').update(`${where.path ?? ''}|${where.line ?? ''}|${where.item ?? ''}|${detail ?? ''}`).digest('hex').slice(0, 16)}`;

// A vendor finding rests on the pack rule that matched, which carries its own remedy; the set's
// rule stays the compliance key.
function findingItem(f, ruleIndex) {
  const ref = f.packRule && ruleIndex.has(f.packRule) ? f.packRule : f.rule;
  const rule = ruleIndex.get(ref);
  const text = f.remedy ?? rule?.remedy ?? ruleIndex.get(f.rule)?.remedy ?? null;
  const fixAt = f.exploitability?.fixAt ?? null;
  return {
    id: `finding:${ref}:${f.fingerprint}`, kind: 'finding', ref,
    where: { path: f.path, line: f.line ?? null, program: f.program ?? null, item: fixAt?.item ?? null },
    detail: f.detail, fingerprint: f.fingerprint, sev: f.sev, evidence: f.evidence, cwe: f.cwe ?? rule?.cwe ?? null,
    verdict: f.exploitability?.verdict ?? null, ...(f.exploitability ? { exploitability: f.exploitability } : {}),
    remediation: { text, steps: rule?.steps ? [...rule.steps] : [], fixAt, gate: { target: f.fingerprint, checks: ['target', 'added', 'layout', 'calls', 'configuration', 'coverage', 'compile'] } },
    compliance: clausesFor(f.rule).map((c) => ({ framework: c.framework, clause: c.clause, ...(c.title ? { title: c.title } : {}) })),
    source: 'cobolwork',
    witnessed: f.executed || f.abend || f.run ? { ...(f.executed !== undefined ? { executed: f.executed } : {}), ...(f.abend ? { abend: f.abend } : {}), ...(f.run ? { run: f.run } : {}) } : null,
  };
}

const practiceItem = (f, practices) => {
  const p = practices.get(f.rule);
  const where = { path: f.path ?? null, line: f.line ?? null, program: f.program ?? null, item: f.item ?? null };
  return {
    id: itemId('practice', f.rule, where, f.detail), kind: 'practice', ref: f.rule, where, detail: f.detail, sev: f.sev ?? p?.sev ?? 'info',
    ...(f.evidence ? { evidence: f.evidence } : {}), verdict: null,
    remediation: { text: p?.how ?? null, steps: p?.steps ? [...p.steps] : [], fixAt: null, gate: null },
    compliance: clausesFor(f.rule).map((c) => ({ framework: c.framework, clause: c.clause, ...(c.title ? { title: c.title } : {}) })),
    source: 'cobolwork', witnessed: null,
  };
};

function inventoryItems(inv) {
  const items = [];
  const push = (ref, where, detail) => {
    const p = INVENTORY_PRACTICES[ref];
    items.push({ id: itemId('inventory', ref, where, detail), kind: 'inventory', ref, where, detail, sev: p.sev, verdict: null, remediation: { text: p.how, steps: [], fixAt: null, gate: null }, compliance: [], source: 'cobolwork', witnessed: null });
  };
  for (const [name, n] of Object.entries(inv.missingCopybooks || {})) push('inventory-missing-copybook', { path: null, line: null, item: name }, `${name} is named by ${n} COPY statement${n === 1 ? '' : 's'} and held nowhere`);
  for (const [name, via] of Object.entries(inv.recursiveCopybooks || {})) push('inventory-recursive-copybook', { path: null, line: null, item: name }, `${name} copies itself${Array.isArray(via) && via.length ? ` through ${via.join(', ')}` : ''}`);
  for (const u of inv.unreadable || []) { const path = typeof u === 'string' ? u : u.path ?? u.file ?? null; push('inventory-unreadable-source', { path, line: null }, typeof u === 'string' ? `${u} could not be read` : `${path} could not be read${u.why ? `: ${u.why}` : ''}`); }
  for (const e of inv.ebcdic || []) { const path = typeof e === 'string' ? e : e.path ?? e.file ?? null; push('inventory-ebcdic-source', { path, line: null }, `${path} is stored in EBCDIC`); }
  return items;
}

function fileCounts(tree) {
  const files = [...new Set(tree.list())];
  const count = (pred) => files.filter(pred).length;
  const known = ['programs', 'copybooks', 'jcl', 'bms', 'hlasm', 'ims', 'db2', 'pli'];
  const counts = { programs: count(isProgram), copybooks: count(isCopybook), jcl: count(isJcl), bms: count(isBms), hlasm: count(isAssembler), ims: count(isIms), db2: count(isDb2), pli: count(isPli) };
  counts.other = Math.max(0, count(isSource) - known.reduce((n, k) => n + counts[k], 0));
  return counts;
}

function optionCensus(tree) {
  const observed = Object.fromEntries(WATCHED.map((f) => [f, {}]));
  let programsWithCards = 0;
  for (const file of [...new Set(tree.list())].filter(isProgram).sort()) {
    let text;
    try { text = tree.text(file).text; } catch { continue; }
    const inForce = optionsInForce(text);
    if (!inForce.size) continue;
    programsWithCards++;
    for (const [family, { value }] of inForce) observed[family][value] = (observed[family][value] || 0) + 1;
  }
  return { observed, programsWithCards };
}

function revisionOf(root) {
  const r = spawnSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : null;
}

const compare = (a, b) => (SEV_RANK[b.sev] || 0) - (SEV_RANK[a.sev] || 0)
  || (VERDICT_RANK[b.verdict] || 0) - (VERDICT_RANK[a.verdict] || 0)
  || KIND_RANK[a.kind] - KIND_RANK[b.kind]
  || (a.where.path ?? '').localeCompare(b.where.path ?? '')
  || (a.where.line ?? 0) - (b.where.line ?? 0)
  || a.id.localeCompare(b.id);

const tally = (items, key) => {
  const out = {};
  for (const it of items) { const k = key(it); if (k === null || k === undefined) continue; out[k] = (out[k] || 0) + 1; }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
};

export function advise(root, opts = {}) {
  const tree = opts.tree || directoryTree(root, opts);
  const report = scanAll(root, { ...opts, tree });
  applyBaseline(report, loadBaseline(root, { explicit: opts.baseline ? resolve(opts.baseline) : null, use: !opts.noBaseline, tree }));
  const inv = inventory(root, { ...opts, tree });
  const practiceReport = scanPractice(root, { ...opts, tree });
  const compiled = compilerAdvice(root, { ironwork: opts.ironwork || null, tree, copylibs: opts.copylibs || opts.systemDirs || [] });
  const cat = catalogue(compiled.catalogue);
  const ruleIndex = new Map(cat.rules.map((r) => [r.id, r]));
  const practices = new Map(cat.practices.map((p) => [p.id, p]));
  const items = [
    ...report.findings.map((f) => findingItem(f, ruleIndex)),
    ...practiceReport.findings.map((f) => practiceItem(f, practices)),
    ...compiled.items,
    ...inventoryItems(inv),
  ].sort(compare);
  const read = treePolicy(root);
  const policy = read?.raw ? { ...DEFAULT_POLICY, ...read.raw } : DEFAULT_POLICY;
  const unmeasured = [...compiled.unmeasured];
  if (report.summary.coverageIncomplete) unmeasured.push('the scan did not read every file: see the scan report\'s coverage for which sets stopped and why');
  if (practiceReport.summary.nosrc) unmeasured.push('no practice rules ran: the practice set has no rules yet');
  return {
    tool: 'cobolwork-advice',
    schemaVersion: ADVICE_SCHEMA_VERSION,
    generatedBy: { toolVersion: TOOL_VERSION, toolRevision: toolRevision(), identity: FINGERPRINT_VERSION, flowModel: FLOW_MODEL },
    repository: { name: basename(root), revision: revisionOf(root) },
    estate: { files: fileCounts(tree), ...compiled.estate, options: { ...optionCensus(tree), policy: { checks: [...policy.checks], options: policy.options, forbid: policy.forbid } } },
    catalogue: cat,
    items,
    summary: {
      items: items.length,
      byKind: tally(items, (i) => i.kind),
      bySev: tally(items, (i) => i.sev),
      byVerdict: tally(items, (i) => i.verdict),
      byProgram: tally(items, (i) => i.where.program),
      byFramework: tally(items.flatMap((i) => i.compliance), (c) => c.framework),
      suppressed: (report.suppressed || []).length,
      coverageIncomplete: report.summary.coverageIncomplete === true,
      ordered: items.map((i) => i.id),
    },
    unmeasured,
  };
}
