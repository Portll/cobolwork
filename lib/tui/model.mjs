// SPDX-License-Identifier: AGPL-3.0-or-later
import { EVIDENCE } from '../kernel/findings.mjs';

export { WHO_ACTS } from '../kernel/findings.mjs';
export const SEVERITIES = Object.freeze(['crit', 'high', 'med', 'low', 'info']);
export const SEV_LETTER = Object.freeze({ crit: 'C', high: 'H', med: 'M', low: 'L', info: 'I' });
export const EVIDENCE_KINDS = Object.freeze(Object.keys(EVIDENCE));

export function readReport(doc) {
  const refuse = (why) => { throw new Error(`not a cobolwork findings report: ${why}`); };
  if (!doc || typeof doc !== 'object') refuse('it is not a JSON object');
  if (typeof doc.tool !== 'string' || !doc.tool.startsWith('cobolwork')) refuse(`its tool is ${JSON.stringify(doc.tool ?? null)}`);
  if (!Array.isArray(doc.findings)) refuse('it has no findings list');
  if (!doc.summary || typeof doc.summary !== 'object') refuse('it has no summary');
  const problem = doc.findings.map(findingProblem).find(Boolean);
  if (problem) refuse(problem);
  const sets = doc.summary.setsIncomplete;
  if (sets !== undefined && (!Array.isArray(sets) || !sets.every((x) => isEntry(x) && typeof x.set === 'string'))) refuse('its incomplete sets are not named');
  return doc;
}

const isEntry = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

function findingProblem(f, i) {
  const n = `finding ${i + 1}`;
  if (!isEntry(f)) return `${n} is not an object`;
  for (const k of ['rule', 'path', 'detail']) if (f[k] != null && typeof f[k] !== 'string') return `${n} has a ${k} that is not text`;
  for (const k of ['related', 'trace']) if (f[k] != null && !(Array.isArray(f[k]) && f[k].every(isEntry))) return `${n} has a ${k} that is not a list of entries`;
  if (f.guardedFrom != null && !isEntry(f.guard)) return `${n} says a check lowered it but names no check`;
  return null;
}

export function banner(report) {
  const s = report.summary;
  if (s.nosrc) return { complete: false, lines: ['COVERAGE: nothing was read - no COBOL, JCL or copybook was found'] };
  const sets = (s.setsIncomplete || []).map((x) => `${x.set.padEnd(9)}${x.kind === 'configuration' ? 'not run: ' : ''}${x.why}`);
  if (!s.coverageIncomplete) {
    return { complete: true, lines: [`Coverage complete: every file was read (${s.filesScanned ?? '?'})`, ...sets] };
  }
  const lines = ['COVERAGE INCOMPLETE - read this before the counts', ...sets];
  if (s.copiesMissing) lines.push(`copy     ${s.copiesMissing} COPY statement(s) name a copybook that is not in the tree`);
  if (s.filesUnreadable) lines.push(`files    ${s.filesUnreadable} file(s) could not be read`);
  if (s.filesOverBudget) lines.push(`budget   ${s.filesOverBudget} file(s) were past the source budget`);
  return { complete: false, lines };
}

export const countsLine = (report) => {
  const bs = report.summary.bySeverity || {};
  const sev = SEVERITIES.map((k) => `${SEV_LETTER[k]} ${bs[k] || 0}`).join(' ');
  const be = report.summary.byEvidence || {};
  const ev = Object.entries(be).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(' ');
  return `Sev ${sev}    Evidence ${ev || 'none'}`;
};

const SORTS = {
  severity: (a, b) => SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev) || cmp(a.rule, b.rule) || cmpWhere(a, b),
  rule: (a, b) => cmp(a.rule, b.rule) || SEVERITIES.indexOf(a.sev) - SEVERITIES.indexOf(b.sev) || cmpWhere(a, b),
  program: (a, b) => cmp(a.program, b.program) || SORTS.severity(a, b),
  where: (a, b) => cmpWhere(a, b) || cmp(a.rule, b.rule),
  evidence: (a, b) => cmp(a.evidence, b.evidence) || SORTS.severity(a, b),
};
export const SORT_NAMES = Object.freeze(Object.keys(SORTS));
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const cmpWhere = (a, b) => cmp(a.path, b.path) || (a.line || 0) - (b.line || 0);

export const DEFAULT_VIEW = Object.freeze({ sort: 'severity', evidence: null, find: '' });

export function rows(report, view = DEFAULT_VIEW) {
  const find = (view.find || '').toUpperCase();
  const out = [];
  for (const f of report.findings) {
    if (view.evidence && !view.evidence.includes(f.evidence)) continue;
    if (find && ![f.rule, f.program, f.path, f.detail].some((x) => x && String(x).toUpperCase().includes(find))) continue;
    out.push({
      f,
      sev: f.sev,
      letter: SEV_LETTER[f.sev] || '?',
      evidence: f.evidence || '',
      rule: f.rule || '',
      program: f.program || '',
      path: f.path || '',
      line: f.line || 0,
      where: f.path ? `${f.path.split('/').pop()}:${f.line ?? ''}` : '',
      cross: !!f.crossProgram,
    });
  }
  return out.sort(SORTS[view.sort] || SORTS.severity);
}

export function viewLabel(view) {
  const parts = [];
  if (view.sort && view.sort !== 'severity') parts.push(`sorted by ${view.sort}`);
  if (view.evidence) parts.push(`evidence ${view.evidence.join(',')}`);
  if (view.find) parts.push(`find ${view.find}`);
  return parts.join(', ');
}
