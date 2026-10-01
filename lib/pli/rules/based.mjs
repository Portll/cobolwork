// SPDX-License-Identifier: AGPL-3.0-or-later
// Rule: BASED storage addressed through a pointer.

export const RULES = {
  'pli-based-storage-addressing': {
    sev: 'info',
    evidence: 'coverage',
    cwe: 'CWE-119',
    text: 'A program addresses storage through a pointer, so data flow through it is not followed'
  }
};

const ADDRESS_ARITHMETIC = new Set(['POINTERADD', 'PTRADD', 'POINTERVALUE', 'PTRVALUE', 'POINTERSUBTRACT', 'PTRSUBTRACT']);

// Whether an expression computes an address rather than copying one.
function computed(tree) {
  if (!tree) return false;
  if (tree.t === 'ref') return ADDRESS_ARITHMETIC.has(tree.name) || tree.args.some((list) => list.some((a) => computed(a.tree)));
  if (tree.op === '+' || tree.op === '-') return true;
  if (tree.t === 'paren') return computed(tree.expr.tree);
  return (tree.args || []).some(computed);
}

export function check(program) {
  const basedVars = [];
  const pointerVars = new Set();
  let firstBasedLine = null;
  let firstPointerAssign = null;

  const walk = (units) => {
    if (!Array.isArray(units)) return;
    for (const unit of units) {
      if (!unit || unit.status !== 'parsed' || !unit.node) continue;
      const node = unit.node;

      if (node.kind === 'DECLARE') {
        for (const item of node.items || []) {
          const name = item.name;
          if (!name) continue;
          const attrs = item.attributes || [];
          const basedAttr = attrs.find((a) => a.name === 'BASED');
          if (basedAttr) {
            basedVars.push({ name, args: basedAttr.args || [] });
            if (firstBasedLine === null) firstBasedLine = unit.line;
          }
          if (attrs.some((a) => a.name === 'POINTER')) {
            pointerVars.add(name.toUpperCase());
          }
        }
      } else if (node.kind === 'ASSIGNMENT') {
        const targets = node.targets || [];
        for (const target of targets) {
          if (target && target.t === 'ref' && target.name && pointerVars.has(target.name.toUpperCase())) {
            if (computed(node.value && node.value.tree) && !firstPointerAssign) firstPointerAssign = { name: target.name, line: unit.line };
          }
        }
      }

      if (node.units) walk(node.units.map((u) => ({ ...u, line: unit.line })));
    }
  };

  walk(program.statements.map((st) => ({ ...st.parsed, line: st.line })));

  if (basedVars.length === 0) return [];

  const names = basedVars.slice(0, 3).map((v) => v.name);
  const namesStr = names.join(', ');
  const count = basedVars.length;

  let detail = `${count} variable${count === 1 ? '' : 's'} declared BASED (${namesStr})`;

  const overlay = (v) => v.args[0] && v.args[0].t === 'word' && v.args[0].u === 'ADDR';
  const hasAddr = basedVars.some(overlay);
  const hasPlain = basedVars.some((v) => !overlay(v));

  if (hasAddr && hasPlain) {
    detail += ', some using ADDR() of declared variables (overlays) and some plain pointers';
  } else if (hasAddr) {
    detail += ', using ADDR() of declared variables (overlays)';
  } else if (hasPlain) {
    detail += ', plain pointers addressing whatever the pointer holds';
  }

  if (firstPointerAssign) {
    detail += `; first computed address assignment to ${firstPointerAssign.name} at line ${firstPointerAssign.line}`;
  }

  return [{
    rule: 'pli-based-storage-addressing',
    path: program.path,
    line: firstBasedLine,
    detail
  }];
}
