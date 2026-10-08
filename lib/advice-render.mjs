// SPDX-License-Identifier: AGPL-3.0-or-later
// The advice document rendered as SARIF 2.1.0 and as Markdown, from its bytes and adding nothing:
// the catalogue entries the items cite become SARIF rules, the items results, and the Markdown
// follows summary.ordered.
import { FINGERPRINT_VERSION } from './kernel/identity.mjs';
import { LEVEL, SECURITY_SEVERITY, uriOf, textOf } from './sarif.mjs';

const SEV_WORD = { crit: 'Critical', high: 'High', med: 'Medium', low: 'Low', info: 'Information' };
const KIND_WORD = { finding: 'finding', compile: 'compiler message', practice: 'practice', option: 'compiler option', inventory: 'inventory' };

function descriptors(doc) {
  const cited = new Set(doc.items.map((i) => i.ref));
  const rules = doc.catalogue.rules.filter((r) => cited.has(r.id)).map((r) => ({
    id: r.id,
    shortDescription: { text: textOf(r.text) },
    ...(r.impact ? { fullDescription: { text: textOf(r.impact) } } : {}),
    ...(r.remedy || r.steps.length ? { help: { text: textOf([r.remedy, ...r.steps.map((s, n) => `${n + 1}. ${s}`)].filter(Boolean).join('\n')) } } : {}),
    defaultConfiguration: { level: LEVEL[r.sev] || 'warning' },
    properties: { kind: 'rule', set: r.set, severity: r.sev, evidence: r.evidence, ...(r.cwe ? { cwe: r.cwe } : {}), ...(SECURITY_SEVERITY[r.sev] ? { 'security-severity': SECURITY_SEVERITY[r.sev] } : {}), compliance: r.compliance, references: r.references },
  }));
  const practices = doc.catalogue.practices.filter((p) => cited.has(p.id)).map((p) => ({
    id: p.id,
    shortDescription: { text: textOf(p.text) },
    ...(p.why ? { fullDescription: { text: textOf(p.why) } } : {}),
    ...(p.how || (p.steps || []).length ? { help: { text: textOf([p.how, ...(p.steps || []).map((s, n) => `${n + 1}. ${s}`)].filter(Boolean).join('\n')) } } : {}),
    defaultConfiguration: { level: LEVEL[p.sev] || 'note' },
    properties: { kind: 'practice', class: p.class, severity: p.sev, compliance: p.compliance, references: p.references },
  }));
  const compiler = doc.catalogue.compiler.filter((m) => cited.has(m.id)).map((m) => ({
    id: m.id,
    shortDescription: { text: textOf(m.text) },
    ...(m.remedy ? { help: { text: textOf(m.remedy) } } : {}),
    defaultConfiguration: { level: m.severity === 'S' ? 'error' : m.severity === 'E' ? 'warning' : 'note' },
    properties: { kind: 'compiler', severity: m.severity, ...(m.practice ? { practice: m.practice } : {}) },
  }));
  return [...rules, ...practices, ...compiler].sort((a, b) => a.id.localeCompare(b.id));
}

export function adviceToSarif(doc) {
  const rules = descriptors(doc);
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i]));
  const uris = [...new Set(doc.items.filter((i) => i.where.path).map((i) => uriOf(i.where.path)))].sort();
  const artifactIndex = new Map(uris.map((u, i) => [u, i]));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'cobolwork-advice', version: doc.generatedBy.toolVersion, informationUri: 'https://github.com/Portll/cobolwork', rules } },
      invocations: [{
        executionSuccessful: true,
        exitCode: 0,
        ...(doc.unmeasured.length ? { toolExecutionNotifications: doc.unmeasured.map((u) => ({ level: 'warning', message: { text: textOf(u) } })) } : {}),
        properties: {
          'cobolwork/advice': { schemaVersion: doc.schemaVersion, repository: doc.repository, estate: doc.estate, summary: { ...doc.summary, ordered: undefined }, unmeasured: doc.unmeasured },
        },
      }],
      ...(uris.length ? { artifacts: uris.map((uri) => ({ location: { uri, uriBaseId: '%SRCROOT%' } })) } : {}),
      results: doc.items.map((it) => ({
        ruleId: it.ref,
        ...(ruleIndex.has(it.ref) ? { ruleIndex: ruleIndex.get(it.ref) } : {}),
        level: LEVEL[it.sev] || 'warning',
        message: { text: textOf(it.detail || it.remediation.text || it.ref) },
        ...(it.fingerprint ? { fingerprints: { [FINGERPRINT_VERSION]: it.fingerprint }, partialFingerprints: { [FINGERPRINT_VERSION]: it.fingerprint } } : {}),
        ...(it.where.path ? { locations: [{ physicalLocation: { artifactLocation: { uri: uriOf(it.where.path), uriBaseId: '%SRCROOT%', index: artifactIndex.get(uriOf(it.where.path)) }, region: { startLine: it.where.line || 1 } } }] } : {}),
        properties: {
          kind: it.kind, id: it.id, severity: it.sev, source: it.source,
          ...(SECURITY_SEVERITY[it.sev] ? { 'security-severity': SECURITY_SEVERITY[it.sev] } : {}),
          ...(it.verdict ? { verdict: it.verdict } : {}),
          ...(it.evidence ? { evidence: it.evidence } : {}),
          ...(it.remediation.fixAt ? { fixAt: it.remediation.fixAt } : {}),
          ...(it.remediation.gate ? { gate: it.remediation.gate } : {}),
          ...(it.compliance.length ? { compliance: it.compliance } : {}),
          ...(it.witnessed ? { witnessed: it.witnessed } : {}),
        },
      })),
    }],
  };
}

const place = (w) => (w.path ? `${w.path}${w.line ? `:${w.line}` : ''}` : w.item ? `copybook ${w.item}` : 'the repository');
const count = (o) => Object.entries(o).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

export function adviceToMarkdown(doc) {
  const lines = [];
  const out = (...l) => lines.push(...l);
  out(`# Advice for ${doc.repository.name}`, '');
  out(`cobolwork ${doc.generatedBy.toolVersion}${doc.repository.revision ? `, at ${doc.repository.revision.slice(0, 12)}` : ''}. ${doc.summary.items} item${doc.summary.items === 1 ? '' : 's'}: ${count(doc.summary.byKind)}. By severity: ${count(doc.summary.bySev)}.`, '');
  if (doc.unmeasured.length) { out('## Not measured', ''); for (const u of doc.unmeasured) out(`- ${u}`); out(''); }
  out('## The estate', '');
  out('| Kind | Files |', '|---|---|');
  for (const [k, v] of Object.entries(doc.estate.files)) out(`| ${k} | ${v} |`);
  out('');
  if (doc.estate.programs) out(`Compiler: ironwork ${doc.estate.compiler?.version ?? ''}. Programs: ${count(doc.estate.programs)}.`, '');
  if (doc.estate.dialect) out(`Dialect: ${doc.estate.dialect.ibmStrict} compile as Enterprise COBOL alone, ${doc.estate.dialect.extendedOnly} need Micro Focus or GnuCOBOL forms${Object.keys(doc.estate.dialect.extensions).length ? ` (${count(doc.estate.dialect.extensions)})` : ''}.`, '');
  const cards = doc.estate.options.programsWithCards;
  out(`Compiler options: ${cards} program${cards === 1 ? '' : 's'} carr${cards === 1 ? 'ies' : 'y'} CBL or PROCESS cards. Policy requires ${doc.estate.options.policy.checks.join(' and ')}.`, '');
  const byId = new Map(doc.items.map((i) => [i.id, i]));
  const catalogue = new Map([...doc.catalogue.rules, ...doc.catalogue.practices, ...doc.catalogue.compiler].map((e) => [e.id, e]));
  let current = null;
  for (const id of doc.summary.ordered) {
    const it = byId.get(id);
    if (!it) continue;
    if (it.sev !== current) { current = it.sev; out(`## ${SEV_WORD[it.sev] || it.sev}`, ''); }
    const entry = catalogue.get(it.ref);
    out(`### ${it.ref} at ${place(it.where)}`, '');
    out(`${KIND_WORD[it.kind] || it.kind}${it.verdict ? `, ${it.verdict}` : ''}${entry?.text ? `: ${entry.text}` : ''}`, '');
    if (it.detail) out(it.detail, '');
    if (it.remediation.text) out(`**Fix.** ${it.remediation.text}`, '');
    if (it.remediation.steps.length) { for (const [n, s] of it.remediation.steps.entries()) out(`${n + 1}. ${s}`); out(''); }
    const fx = it.remediation.fixAt;
    if (fx) out(`**Where.** ${fx.test ? fx.test : `${fx.path}:${fx.line}, ${fx.item}: ${fx.why}`}`, '');
    if (it.compliance.length) out(`Compliance: ${it.compliance.map((c) => `${c.framework} ${c.clause}`).join('; ')}.`, '');
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}
