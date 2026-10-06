// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for HLASM section and linkage instructions: CSECT, DSECT, RSECT, START, COM, LOCTR, ENTRY,
// EXTRN, WXTRN, AMODE, RMODE, ALIAS, XATTR, CATTR, DXD, CXD.
import { HlasmSyntax, NAME, splitOperands } from '../operands.mjs';
import { parseExpression } from '../expr.mjs';

const AMODE_VALUES = new Set(['24', '31', '64', 'ANY', 'ANY31', 'ANY64']);
const RMODE_VALUES = new Set(['24', '31', '64', 'ANY']);
const XATTR_VALUES = {
  ATTRIBUTES: null,
  LINKAGE: new Set(['OS', 'XPLINK']),
  PSECT: null,
  REFERENCE: new Set(['DIRECT', 'INDIRECT', 'DATA', 'CODE']),
  SCOPE: new Set(['SECTION', 'MODULE', 'LIBRARY', 'IMPORT', 'EXPORT']),
};
const CATTR_VALUES = {
  ALIGN: null,
  DEFLOAD: true,
  EXECUTABLE: true,
  FILL: null,
  NOLOAD: true,
  NOTEXECUTABLE: true,
  NOTREUSABLE: true,
  PART: null,
  PRIORITY: null,
  READONLY: true,
  REFRESH: true,
  RENT: true,
  REUSABLE: true,
  RMODE: new Set(['24', '31', 'ANY', '64']),
};

function noOperand(kind, st, requireName) {
  if (st.field.trim()) throw new HlasmSyntax(`${kind} takes no operand`);
  if (requireName && !st.name) throw new HlasmSyntax(`${kind} requires a name`);
  return { kind, name: st.name || null };
}

function nameList(kind, st) {
  const ops = splitOperands(st.field);
  if (!ops.length) throw new HlasmSyntax(`${kind} requires at least one operand`);
  const names = [];
  const parts = [];
  for (const op of ops) {
    const t = op.trim();
    if (!t) throw new HlasmSyntax(`${kind} has an empty operand`);
    const m = /^PART\(([\s\S]*)\)$/i.exec(t);
    if (m) {
      for (const p of m[1].split(',')) {
        const n = p.trim();
        if (!NAME.test(n)) throw new HlasmSyntax(`${kind} PART has an invalid name '${n}'`);
        parts.push(n.toUpperCase());
      }
    } else if (NAME.test(t)) {
      names.push(t.toUpperCase());
    } else {
      throw new HlasmSyntax(`${kind} operand '${t}' is not a name or PART(...)`);
    }
  }
  return { kind, names, parts };
}

function mode(kind, st, values) {
  const ops = splitOperands(st.field);
  if (ops.length !== 1) throw new HlasmSyntax(`${kind} takes exactly one operand`);
  const v = ops[0].trim().toUpperCase();
  if (!values.has(v)) throw new HlasmSyntax(`${kind} operand '${v}' is not a valid mode`);
  return { kind, name: st.name || null, mode: v };
}

function alias(st) {
  const ops = splitOperands(st.field);
  if (ops.length !== 1) throw new HlasmSyntax('ALIAS takes exactly one operand');
  if (!st.name) throw new HlasmSyntax('ALIAS requires a name');
  const t = ops[0].trim();
  const m = /^([CX])'((?:[^']|'')*)'$/i.exec(t);
  if (!m) throw new HlasmSyntax('ALIAS operand must be C\'string\' or X\'hex\'');
  return { kind: 'ALIAS', name: st.name, alias: { type: m[1].toUpperCase(), text: m[2] } };
}

function xattr(st) {
  if (!st.name) throw new HlasmSyntax('XATTR requires a name');
  const ops = splitOperands(st.field);
  if (!ops.length) throw new HlasmSyntax('XATTR requires at least one operand');
  const attributes = {};
  for (const op of ops) {
    const t = op.trim();
    const m = /^([A-Z]+)(?:\(([\s\S]*)\))?$/i.exec(t);
    if (!m) throw new HlasmSyntax(`XATTR operand '${t}' is not a keyword`);
    const key = m[1].toUpperCase();
    if (!(key in XATTR_VALUES)) throw new HlasmSyntax(`XATTR keyword '${key}' is not recognised`);
    const val = m[2] !== undefined ? m[2].trim() : null;
    if (val !== null) {
      const allowed = XATTR_VALUES[key];
      if (allowed && !allowed.has(val.toUpperCase())) throw new HlasmSyntax(`XATTR ${key} value '${val}' is not valid`);
    }
    attributes[key] = val !== null ? val : true;
  }
  return { kind: 'XATTR', name: st.name, attributes };
}

function cattr(st) {
  if (!st.name) throw new HlasmSyntax('CATTR requires a name');
  const ops = splitOperands(st.field);
  if (!ops.length) throw new HlasmSyntax('CATTR requires at least one operand');
  const attributes = {};
  for (const op of ops) {
    const t = op.trim();
    const m = /^([A-Z]+)(?:\(([\s\S]*)\))?$/i.exec(t);
    if (!m) throw new HlasmSyntax(`CATTR operand '${t}' is not a keyword`);
    const key = m[1].toUpperCase();
    if (!(key in CATTR_VALUES)) throw new HlasmSyntax(`CATTR keyword '${key}' is not recognised`);
    const val = m[2] !== undefined ? m[2].trim() : null;
    if (val !== null) {
      const allowed = CATTR_VALUES[key];
      if (allowed instanceof Set && !allowed.has(val.toUpperCase())) throw new HlasmSyntax(`CATTR ${key} value '${val}' is not valid`);
    }
    attributes[key] = val !== null ? val : true;
  }
  return { kind: 'CATTR', name: st.name, attributes };
}

function dxd(st) {
  if (!st.name) throw new HlasmSyntax('DXD requires a name');
  const ops = splitOperands(st.field);
  if (ops.length !== 1) throw new HlasmSyntax('DXD takes exactly one operand');
  return { kind: 'DXD', name: st.name, operand: ops[0].trim() };
}

export const parsers = {
  CSECT: (st) => noOperand('CSECT', st, false),
  // An unnamed dummy section, like an unnamed COM, is defined when the name entry is omitted.
  // https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=sections-unnamed-section
  DSECT: (st) => noOperand('DSECT', st, false),
  RSECT: (st) => noOperand('RSECT', st, false),
  COM: (st) => noOperand('COM', st, false),
  START: (st) => {
    const ops = splitOperands(st.field);
    if (ops.length > 1) throw new HlasmSyntax('START takes at most one operand');
    const origin = ops.length ? parseExpression(ops[0].trim()) : null;
    return { kind: 'START', name: st.name || null, origin };
  },
  LOCTR: (st) => {
    if (!st.name) throw new HlasmSyntax('LOCTR requires a name');
    if (st.field.trim()) throw new HlasmSyntax('LOCTR takes no operand');
    return { kind: 'LOCTR', name: st.name };
  },
  ENTRY: (st) => nameList('ENTRY', st),
  EXTRN: (st) => nameList('EXTRN', st),
  WXTRN: (st) => nameList('WXTRN', st),
  AMODE: (st) => mode('AMODE', st, AMODE_VALUES),
  RMODE: (st) => mode('RMODE', st, RMODE_VALUES),
  ALIAS: alias,
  XATTR: xattr,
  CATTR: cattr,
  DXD: dxd,
  CXD: (st) => {
    if (st.field.trim()) throw new HlasmSyntax('CXD takes no operand');
    return { kind: 'CXD', name: st.name || null };
  },
};
