// SPDX-License-Identifier: AGPL-3.0-or-later
// Security rules over Db2 DDL: what a GRANT opens to PUBLIC or lets a grantee pass on, system and
// database authorities granted, and exit routines a table runs inside Db2.
import { readDb2, parseDb2Statement } from './read.mjs';

const WRITES = new Set(['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'ALL']);
const AUTHORITIES = new Set(['SYSADM', 'SYSCTRL', 'SYSOPR', 'DBADM', 'DBCTRL', 'DBMAINT', 'SECADM', 'ACCESSCTRL', 'DATAACCESS']);
const FLAGGED_AUTHORITIES = new Set(['SYSADM', 'SYSCTRL', 'DBADM', 'DBCTRL', 'SECADM', 'ACCESSCTRL', 'DATAACCESS']);

export const DB2_RULES = Object.freeze({
  'db2-grant-to-public': { sev: 'high', evidence: 'construct', cwe: 'CWE-732', text: 'A GRANT gives privileges to PUBLIC, every authorization ID' },
  'db2-grant-with-grant-option': { sev: 'med', evidence: 'construct', cwe: 'CWE-269', text: 'WITH GRANT OPTION lets the grantee grant the privilege to others' },
  'db2-system-authority-granted': { sev: 'med', evidence: 'construct', cwe: 'CWE-250', text: 'A system or database authority is granted' },
  'db2-exit-routine-declared': { sev: 'info', evidence: 'construct', cwe: 'CWE-829', text: 'A table names an exit routine that runs inside Db2' },
});

const scope = (node) => (node.objects ? ` on ${node.objectType} ${node.objects.map((o) => o.join('.')).join(', ')}` : node.objectType ? ` on ${node.objectType}` : '');

function grantFindings(node, at) {
  const privileges = node.privileges.map((p) => p.name);
  const what = `${privileges.join(', ')}${scope(node)}`;
  const grantees = node.grantees.map((g) => g.name).join(', ');
  const out = [];
  if (node.grantees.some((g) => g.type === 'PUBLIC')) {
    const crit = privileges.some((p) => WRITES.has(p) || AUTHORITIES.has(p));
    out.push(at('db2-grant-to-public', `${what} granted to PUBLIC`, crit ? 'crit' : undefined));
  }
  if (node.withGrantOption) out.push(at('db2-grant-with-grant-option', `${grantees} may grant ${what} to others`));
  for (const p of privileges.filter((x) => FLAGGED_AUTHORITIES.has(x))) out.push(at('db2-system-authority-granted', `${p}${scope(node)} granted to ${grantees}`));
  return out;
}

function exitRoutineFindings(node, at) {
  const out = [];
  if (node.options?.editproc) out.push(at('db2-exit-routine-declared', `${node.name} runs EDITPROC ${node.options.editproc.program}`));
  if (node.options?.validproc) out.push(at('db2-exit-routine-declared', `${node.name} runs VALIDPROC ${node.options.validproc}`));
  for (const col of node.columns || []) {
    if (col.fieldproc) out.push(at('db2-exit-routine-declared', `${node.name}.${col.name} runs FIELDPROC ${col.fieldproc.program}`));
  }
  return out;
}

export function checkDb2(path, text) {
  const findings = [];
  for (const st of readDb2(text).statements) {
    const r = parseDb2Statement(st);
    if (r.status !== 'parsed') continue;
    const at = (rule, detail, sev = DB2_RULES[rule].sev) => ({ rule, path, line: st.line, sev, detail });
    if (r.kind === 'GRANT') findings.push(...grantFindings(r.node, at));
    else if (r.kind === 'CREATE TABLE') findings.push(...exitRoutineFindings(r.node, at));
  }
  return findings;
}
