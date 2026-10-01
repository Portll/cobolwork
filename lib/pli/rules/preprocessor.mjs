// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I rules on preprocessor use.

export const RULES = {
  'pli-preprocessor-in-use': {
    sev: 'info',
    evidence: 'coverage',
    cwe: 'CWE-1059',
    text: 'A program uses PL/I preprocessor directives, so the source text is not the code that is compiled'
  }
};

// Directives that change the text compiled; INCLUDE is read through and listing directives change nothing.
const DIRECTIVES = new Set(['IF', 'DO', 'DCL', 'DECLARE', 'ASSIGN', 'ACT', 'ACTIVATE', 'DEACT', 'DEACTIVATE', 'PROC', 'PROCEDURE', 'SELECT', 'REPLACE', 'GO', 'GOTO']);

function collectDirectives(node, set) {
  if (!node) return;
  if (node.kind === 'PREPROCESSOR' && typeof node.directive === 'string') {
    const d = node.directive.toUpperCase();
    if (DIRECTIVES.has(d)) set.add(d);
  }
  if (Array.isArray(node.units)) {
    for (const u of node.units) {
      if (u && u.node) collectDirectives(u.node, set);
    }
  }
}

export function check(program) {
  const findings = [];
  const directives = new Set();
  let firstLine = null;

  for (const st of program.statements) {
    if (!st.parsed || st.parsed.status !== 'parsed') continue;
    const node = st.parsed.node;
    if (!node) continue;
    collectDirectives(node, directives);
    if (directives.size > 0 && firstLine === null) {
      firstLine = st.line;
    }
  }

  if (firstLine !== null) {
    const list = [...directives].sort().join(', ');
    findings.push({
      rule: 'pli-preprocessor-in-use',
      path: program.path,
      line: firstLine,
      detail: `preprocessor directives ${list} alter the source before compilation`
    });
  }

  return findings;
}
