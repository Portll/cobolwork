// SPDX-License-Identifier: AGPL-3.0-or-later
// What the compiler says about every program, for the advice document: `ironwork check` over the
// tree, its W, E, S and X messages as compile items keyed by id, and the estate's dialect census
// from the same run. Without ironwork every part here is reported unmeasured.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isProgram } from './sources.mjs';
import { checkWithIronwork, duration, ironworkVersion, messageClass } from './ironwork.mjs';

const MESSAGES = JSON.parse(readFileSync(new URL('../rules/ironwork-messages.json', import.meta.url), 'utf8'));
const BY_ID = new Map(MESSAGES.messages.map((m) => [m.id, m]));
const MAX_PROGRAMS = 5000;
const BUDGET_MS = 30 * 60 * 1000;
const SEV = { S: 'high', U: 'high', E: 'med', W: 'low' };

export const ironworkRemedy = (id) => MESSAGES.remedies[id] ?? null;

// The id scheme of advice.mjs's items, with no `item` part.
const itemId = (kind, ref, where, detail) => `${kind}:${ref}:${createHash('sha256').update(`${where.path ?? ''}|${where.line ?? ''}||${detail ?? ''}`).digest('hex').slice(0, 16)}`;

// The first PROGRAM-ID in the file, outside comment lines.
function programName(file) {
  let text;
  try { text = readFileSync(file, 'latin1'); } catch { return null; }
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 6 && (line[6] === '*' || line[6] === '/')) continue;
    if (/^\s*\*>/.test(line)) continue;
    const m = /\bPROGRAM-ID\s*\.?\s*['"]?([A-Za-z0-9][A-Za-z0-9-]*)/i.exec(line);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

const sevOf = (m) => (m.id[2] === 'X' ? 'info' : SEV[m.severity] ?? null);

export function compilerAdvice(root, { ironwork = null, tree = null, copylibs = [], env = process.env, maxPrograms = MAX_PROGRAMS, budgetMs = BUDGET_MS } = {}) {
  const estate = { compiler: null, programs: null, dialect: null };
  if (!ironwork) return { estate, items: [], catalogue: [], unmeasured: ['no compiler ran: pass --ironwork <path> to compile every program with ironwork check'] };
  const said = ironworkVersion(ironwork, { env });
  const dir = tree && tree.kind === 'directory' ? tree : null;
  const result = checkWithIronwork(ironwork, root, {
    programs: dir ? [...new Set(dir.list())].filter(isProgram).sort() : null, copyDirs: dir ? dir.index.copyDirs : null,
    copylibs, env, extended: true, maxPrograms, budgetMs,
  });
  estate.compiler = { tool: 'ironwork', version: said ? (/\d+\.\d+\.\d+\S*/.exec(said)?.[0] ?? said) : null };
  estate.programs = {
    count: result.programs, compiled: result.accepted, failed: result.failed.length,
    notModelled: result.notModelled.length, unresolved: result.unresolved.length, unread: result.unread.length, unrun: result.unrun.length,
  };

  // A program that fails strict is read from its --compliance extended run, where each form strict
  // refused is an IWX message and the errors left are its own. `extensions` counts programs per form.
  // Only a message about the program is an item.
  const items = new Map();
  const extensions = {};
  const refused = new Set(), limits = new Set(), unknown = new Set();
  const printed = new Map();
  let unnamed = 0;
  for (const c of result.checked) {
    const messages = c.extended ? c.extended.messages : c.messages;
    const program = programName(c.file);
    const forms = new Set();
    const sources = new Map();
    for (const m of messages) {
      if (!m.id) { unnamed++; continue; }
      const about = messageClass(m, sources);
      if (about === 'refused') refused.add(m.id);
      else if (about === 'limit') limits.add(m.id);
      else if (about === 'unknown') unknown.add(m.id);
      if (about !== 'program') continue;
      const sev = sevOf(m);
      if (!sev) continue;
      if (m.id[2] === 'X') forms.add(m.id);
      const where = { path: m.path, line: m.line, program };
      const id = itemId('compile', m.id, where, m.text);
      // A message in a member that several programs copy is one item, under the first of them.
      if (items.has(id)) continue;
      if (!printed.has(m.id)) printed.set(m.id, m);
      items.set(id, {
        id, kind: 'compile', ref: m.id, where, detail: m.text, sev, evidence: 'construct', verdict: null,
        remediation: { text: ironworkRemedy(m.id), steps: [], fixAt: null, gate: null },
        compliance: [], source: 'ironwork', witnessed: null,
      });
    }
    for (const f of forms) extensions[f] = (extensions[f] || 0) + 1;
  }
  estate.dialect = {
    ibmStrict: result.accepted,
    extendedOnly: result.checked.filter((c) => c.extended?.compiled).length,
    extensions: Object.fromEntries(Object.entries(extensions).sort(([a], [b]) => a.localeCompare(b))),
  };

  const list = [...items.values()];
  const cited = [...new Set(list.map((i) => i.ref))].sort();
  // An id this cobolwork's copy of the catalogue predates is described as ironwork printed it.
  const catalogue = cited.map((id) => {
    const m = BY_ID.get(id) || printed.get(id);
    return { id, severity: m.severity, text: m.text, remedy: ironworkRemedy(id) };
  });

  const unmeasured = [];
  if (!said) unmeasured.push('ironwork --version gave no answer, so the compiler version is not recorded');
  if (result.notModelled.length) unmeasured.push(`ironwork check: ${result.notModelled.length} program(s) use what ironwork does not model yet${refused.size ? ` (${[...refused].sort().join(', ')})` : ''}, so whether they compile is not decided`);
  else if (refused.size) unmeasured.push(`ironwork check refused by name what it does not model yet (${[...refused].sort().join(', ')})`);
  if (limits.size) unmeasured.push(`ironwork check reached its own limits (${[...limits].sort().join(', ')}), so the programs that hit them were not read whole`);
  if (result.unresolved.length) unmeasured.push(`ironwork check: ${result.unresolved.length} program(s) copy a member the copy libraries do not hold; name the estate's with --copylib`);
  if (result.unread.length) unmeasured.push(`ironwork check: ${result.unread.length} program(s) stop at a message whose id this cobolwork does not read, so whether they compile is not decided`);
  if (unknown.size) unmeasured.push(`ironwork check gave message ids this cobolwork does not read (${[...unknown].sort().join(', ')}), which are not items`);
  const ended = result.unrun.filter((u) => !u.why.startsWith('not checked: '));
  if (ended.length) unmeasured.push(`ironwork check: ${ended.length} program(s) were not checked; the first, ${ended[0].path}: ${ended[0].why}`);
  if (result.bounded.cap) unmeasured.push(`ironwork check: the first ${maxPrograms} of ${result.programs} programs were checked, and the rest are counted unrun`);
  if (result.bounded.budget) unmeasured.push(`ironwork check: the ${duration(budgetMs)} budget ran out before every program was checked, and the rest are counted unrun`);
  if (result.bounded.extendedSkipped) unmeasured.push(`ironwork check: the ${duration(budgetMs)} budget ran out before ${result.bounded.extendedSkipped} program(s) that fail strict were checked under --compliance extended, so extendedOnly and extensions are lower bounds`);
  if (unnamed) unmeasured.push(`ironwork check printed ${unnamed} line(s) with no message id, which are not items`);
  return { estate, items: list, catalogue, unmeasured };
}
