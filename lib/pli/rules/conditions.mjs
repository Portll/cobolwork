// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I rules on condition handling.

export const RULES = {
  'pli-error-condition-ignored': {
    sev: 'low',
    evidence: 'construct',
    cwe: 'CWE-390',
    text: 'An ON unit for a condition does nothing with it, so the condition is silently ignored',
    impact: 'A failure the condition reports, such as a conversion error, a division by zero, a subscript out of range or a file that would not open, reaches an ON unit that does nothing with it, so no message or log says the operation failed',
    remedy: 'Handle the condition in its ON unit: record it and recover, or end the run with a message; where a condition is expected, test for it and act rather than leave the unit empty'
  }
};

const IGNORED_CONDITIONS = new Set([
  'ERROR', 'ANYCONDITION', 'ANYCOND', 'CONVERSION', 'CONV',
  'ZERODIVIDE', 'ZDIV', 'FIXEDOVERFLOW', 'FOFL', 'SIZE',
  'STRINGRANGE', 'STRG', 'SUBSCRIPTRANGE', 'SUBRG', 'KEY',
  'RECORD', 'TRANSMIT', 'UNDEFINEDFILE', 'UNDF'
]);

const BLOCK_OPENERS = new Set(['BEGIN', 'DO', 'SELECT', 'PROCEDURE', 'PACKAGE']);

// Whether a statement opens a block that a later END closes: BEGIN, DO, SELECT or a procedure,
// itself or as the unit of an IF, ELSE, WHEN, OTHERWISE or ON.
function opens(r) {
  if (!r || r.status !== 'parsed' || !r.node) return false;
  if (BLOCK_OPENERS.has(r.kind)) return true;
  const units = r.node.units || [];
  return units.length > 0 && opens(units[units.length - 1]);
}

// The statements of the block a statement at `at` opens, up to and not including its END.
function blockBody(statements, at) {
  let depth = 1;
  for (let k = at + 1; k < statements.length; k++) {
    const r = statements[k].parsed;
    if (r.kind === 'END') { if (--depth === 0) return statements.slice(at + 1, k); continue; }
    if (opens(r)) depth++;
  }
  return statements.slice(at + 1);
}

// Doing nothing is a null unit, a block that is empty, or only jumping away.
const inert = (r) => r.kind === 'NULL' || r.kind === 'GOTO';

export function check(program) {
  const findings = [];
  const statements = program.statements;
  statements.forEach((st, at) => {
    const r = st.parsed;
    if (r.status !== 'parsed' || r.kind !== 'ON' || r.node.system) return;
    const names = r.node.conditions.filter((c) => IGNORED_CONDITIONS.has(c.name)).map((c) => c.name);
    if (!names.length) return;
    const unit = r.node.units[0];
    const on = `ON ${names.join(', ')}`;
    let detail = null;
    if (!unit) detail = `${on} has a null unit, so the condition is raised and dropped`;
    else if (unit.kind === 'GOTO') detail = `${on} only does GO TO ${unit.node.target.path.join('.')}`;
    else if (unit.kind === 'BEGIN') {
      const body = blockBody(statements, at).map((s) => s.parsed);
      if (!body.length) detail = `${on} has an empty BEGIN block`;
      else if (body.every(inert)) detail = `${on} has a BEGIN block that only does GO TO ${body.filter((b) => b.kind === 'GOTO').map((b) => b.node.target.path.join('.')).join(', ')}`;
    }
    if (detail) findings.push({ rule: 'pli-error-condition-ignored', path: program.path, line: st.line, detail });
  });
  return findings;
}
