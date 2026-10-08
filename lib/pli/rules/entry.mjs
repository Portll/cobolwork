// SPDX-License-Identifier: AGPL-3.0-or-later
// PL/I rules on calls through entry variables and FETCH of a non-literal title.

import { IBM } from '../../kernel/manuals.mjs';

export const RULES = {
  'pli-entry-variable-call': {
    sev: 'info',
    evidence: 'coverage',
    cwe: 'CWE-470',
    text: 'A CALL through an entry variable dispatches to a procedure chosen at run time, so the callee is not known statically',
  },
  'pli-fetch-title-variable': {
    sev: 'med',
    evidence: 'construct',
    cwe: 'CWE-494',
    text: 'A FETCH whose TITLE is not a literal names the module to load at run time',
    impact: 'FETCH loads the load module whose name the TITLE value holds when the statement runs, so whatever sets that value chooses the code the program then calls, with the program\'s authority',
    remedy: 'Give FETCH a literal TITLE where the module is fixed; where it must vary, check the name against a list of the modules the program may load before the FETCH',
    references: [IBM.pliFetch],
  },
};

function walkUnits(units, visit) {
  if (!Array.isArray(units)) return;
  for (const u of units) {
    if (!u || typeof u !== 'object') continue;
    visit(u);
    if (u.node && typeof u.node === 'object') walkUnits(u.node.units, visit);
  }
}

function eachParsed(program, visit) {
  for (const st of program.statements) {
    if (!st || !st.parsed || st.parsed.status !== 'parsed') continue;
    visit(st);
    walkUnits(st.parsed.node && st.parsed.node.units, (u) => {
      if (u && u.status === 'parsed') visit({ line: st.line, parsed: u });
    });
  }
}

function isEntryVariable(item) {
  if (!item || !Array.isArray(item.attributes)) return false;
  const names = new Set(item.attributes.map((a) => (a && a.name ? String(a.name).toUpperCase() : '')));
  return names.has('ENTRY') && names.has('VARIABLE');
}

function isEntryMember(item) {
  if (!item || !Array.isArray(item.attributes)) return false;
  const names = new Set(item.attributes.map((a) => (a && a.name ? String(a.name).toUpperCase() : '')));
  return names.has('ENTRY') && !names.has('VARIABLE');
}

function isProcedure(name, procedures) {
  return procedures.has(String(name || '').toUpperCase());
}

const isLiteralTitle = (title) => !!title && title.tree && title.tree.t === 'lit';

export function check(program) {
  const findings = [];
  if (!program || !Array.isArray(program.statements)) return findings;

  const entryVariables = new Map();
  const entryMembers = new Set();
  const procedures = new Set();

  eachParsed(program, (st) => {
    const node = st.parsed && st.parsed.node;
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'DECLARE' && Array.isArray(node.items)) {
      for (const item of node.items) {
        if (!item || !item.name) continue;
        const key = String(item.name).toUpperCase();
        // A member of a structure is a variable whatever it declares.
        if (isEntryVariable(item) || (item.level > 1 && isEntryMember(item))) entryVariables.set(key, item.name);
        else if (isEntryMember(item)) entryMembers.add(key);
      }
    } else if (node.kind === 'PROCEDURE' && node.name) {
      procedures.add(String(node.name).toUpperCase());
    }
  });

  const assignedConstants = new Map();
  eachParsed(program, (st) => {
    const node = st.parsed && st.parsed.node;
    if (!node || node.kind !== 'ASSIGNMENT') return;
    const ref = node.value && node.value.tree;
    if (!Array.isArray(node.targets) || !ref || ref.t !== 'ref' || !ref.name) return;
    const valueName = String(ref.name).toUpperCase();
    if (!procedures.has(valueName) && !entryMembers.has(valueName)) return;
    for (const target of node.targets) {
      if (!target || target.t !== 'ref' || !target.name) continue;
      const key = String(target.name).toUpperCase();
      if (!entryVariables.has(key)) continue;
      if (!assignedConstants.has(key)) assignedConstants.set(key, new Set());
      assignedConstants.get(key).add(ref.name);
    }
  });

  eachParsed(program, (st) => {
    const node = st.parsed && st.parsed.node;
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'CALL') {
      const callee = node.callee;
      if (!callee || callee.t !== 'ref' || !callee.name) return;
      const key = String(callee.name).toUpperCase();
      if (entryVariables.has(key)) {
        const varName = entryVariables.get(key);
        const constants = assignedConstants.get(key);
        const detail = constants && constants.size
          ? `CALL ${callee.name} dispatches through an entry variable assigned ${[...constants].join(', ')}`
          : `CALL ${callee.name} dispatches through an entry variable with no entry constant assigned in this program`;
        findings.push({ rule: 'pli-entry-variable-call', path: program.path, line: st.line, detail });
      }
    } else if (node.kind === 'FETCH' && Array.isArray(node.entries)) {
      for (const entry of node.entries) {
        if (!entry || entry.title === null || entry.title === undefined) continue;
        if (isLiteralTitle(entry.title)) continue;
        const name = entry.name || 'FETCH';
        findings.push({
          rule: 'pli-fetch-title-variable',
          path: program.path,
          line: st.line,
          detail: `FETCH ${name} loads a module named at run time because its TITLE is not a literal`,
        });
      }
    }
  });

  return findings;
}
