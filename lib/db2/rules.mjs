// SPDX-License-Identifier: AGPL-3.0-or-later
// Security rules over Db2 DDL: what a GRANT opens to PUBLIC or lets a grantee pass on, system and
// database authorities granted, and exit routines a table runs inside Db2.
import { readDb2, parseDb2Statement } from './read.mjs';

const WRITES = new Set(['INSERT', 'UPDATE', 'DELETE', 'ALTER', 'ALL']);
const AUTHORITIES = new Set(['SYSADM', 'SYSCTRL', 'SYSOPR', 'DBADM', 'DBCTRL', 'DBMAINT', 'SECADM', 'ACCESSCTRL', 'DATAACCESS']);
const FLAGGED_AUTHORITIES = new Set(['SYSADM', 'SYSCTRL', 'DBADM', 'DBCTRL', 'SECADM', 'ACCESSCTRL', 'DATAACCESS']);

export const DB2_RULES = Object.freeze({
  'db2-grant-to-public': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-732',
    text: 'A GRANT gives privileges to PUBLIC, every authorization ID',
    impact: 'Every user and every program that can connect to the subsystem holds the privilege, now and whoever is added later; a write privilege or an authority to PUBLIC lets anyone change the data',
    remedy: 'Grant to the roles or authorization IDs that need the privilege, and REVOKE it FROM PUBLIC',
  },
  'db2-grant-with-grant-option': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-269',
    text: 'WITH GRANT OPTION lets the grantee grant the privilege to others',
    impact: 'Who holds the privilege is no longer decided by whoever administers it: the grantee can pass it on, and the grants it makes outlive a review of its own',
    remedy: 'Grant without WITH GRANT OPTION, and keep the authority to grant with the administrators who own the object',
  },
  'db2-system-authority-granted': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-250',
    text: 'A system or database authority is granted',
    impact: 'The grantee can create, change, drop or read objects across the subsystem or database, beyond any one table a job needs',
    remedy: 'Grant the table and routine privileges the work needs; keep SYSADM, DBADM and the other authorities with named administrators, and record who holds them',
  },
  'db2-exit-routine-declared': { sev: 'info', evidence: 'context', cwe: 'CWE-829', text: 'A table names an exit routine that runs inside Db2' },
  'db2-external-routine': { sev: 'info', evidence: 'context', cwe: 'CWE-829', text: 'A procedure or function runs an external load module' },
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

// The load module an external routine runs, with the authority and address space it runs under.
function externalRoutineFindings(node, at) {
  if (!node.external) return [];
  const module = node.external.implicit ? `${node.external.name} (named by the routine)` : node.external.name;
  const where = node.wlmEnvironment ? ` in WLM environment ${node.wlmEnvironment.name}` : '';
  return [at('db2-external-routine', `${node.name} runs ${node.language} load module ${module} with SECURITY ${node.security}${where}`)];
}

// The findings one statement, already parsed, gives.
export function statementFindings(path, st, r) {
  if (r.status !== 'parsed') return [];
  const at = (rule, detail, sev = DB2_RULES[rule].sev) => ({ rule, path, line: st.line, sev, detail });
  if (r.kind === 'GRANT') return grantFindings(r.node, at);
  if (r.kind === 'CREATE TABLE') return exitRoutineFindings(r.node, at);
  if (r.kind === 'CREATE PROCEDURE' || r.kind === 'CREATE FUNCTION') return externalRoutineFindings(r.node, at);
  return [];
}

export const checkDb2 = (path, text) => readDb2(text).statements.flatMap((st) => statementFindings(path, st, parseDb2Statement(st)));
