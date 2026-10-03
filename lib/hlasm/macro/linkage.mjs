// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the z/OS linkage macros CALL, SAVE, and RETURN.
import { HlasmSyntax, NAME } from '../operands.mjs';

const CALL_KW = new Set(['ID', 'LINKINST', 'PLIST4', 'PLIST8', 'PLIST8ARALETS', 'PARAM64', 'MF']);
const RETURN_KW = new Set(['RC', 'RETREGS']);

function parseCall(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length < 1 || positional.length > 3) {
    throw new HlasmSyntax(`CALL expects 1 to 3 positional operands, got ${positional.length}`);
  }
  const entryRaw = positional[0].trim();
  let entry = null;
  let register = null;
  const regMatch = /^\((\d+)\)$/.exec(entryRaw);
  // The list form (MF=L) builds only the parameter list, so it names no entry.
  const listForm = /^L$/i.test(String(keywords.get('MF') || '').trim());
  if (regMatch) {
    register = entryRaw;
  } else if (NAME.test(entryRaw)) {
    entry = entryRaw;
  } else if (!(entryRaw === '' && listForm)) {
    throw new HlasmSyntax(`CALL entry operand '${entryRaw}' is not a valid name or register`);
  }

  let params = [];
  if (positional.length >= 2) {
    const paramsRaw = positional[1].trim();
    if (paramsRaw.startsWith('(') && paramsRaw.endsWith(')')) {
      const inner = paramsRaw.slice(1, -1).trim();
      if (inner) {
        params = inner.split(',').map(s => s.trim());
      }
    }
  }

  const node = { kind: 'CALL', entry, register, params, vl: false, keywords: {} };
  if (positional.length === 3) {
    const vlRaw = positional[2].trim().toUpperCase();
    if (vlRaw !== 'VL') {
      throw new HlasmSyntax('CALL third positional operand must be VL');
    }
    node.vl = true;
    node.keywords.VL = positional[2];
  }
  for (const [k, v] of keywords) {
    if (k === 'VL') {
      node.vl = true;
      node.keywords[k] = v;
    } else if (CALL_KW.has(k)) {
      node.keywords[k] = v;
    } else {
      throw new HlasmSyntax(`CALL does not accept keyword ${k}`);
    }
  }
  return node;
}

function parseSave(st, ops) {
  const { positional, keywords } = ops;
  if (keywords.size > 0) {
    throw new HlasmSyntax('SAVE does not accept keywords');
  }
  if (positional.length < 1 || positional.length > 3) {
    throw new HlasmSyntax(`SAVE expects 1 to 3 positional operands, got ${positional.length}`);
  }

  const regRaw = positional[0].trim();
  if (!regRaw.startsWith('(') || !regRaw.endsWith(')')) {
    throw new HlasmSyntax('SAVE first operand must be a parenthesized register list');
  }
  const inner = regRaw.slice(1, -1).trim();
  const registers = inner ? inner.split(',').map(s => s.trim()) : [];

  let t = false;
  let id = null;
  let idx = 1;
  // The second slot is T or empty: SAVE (14,12),,* omits T and names the identifier.
  if (idx < positional.length) {
    const next = positional[idx].trim().toUpperCase();
    if (next === 'T' || next === '') {
      t = next === 'T';
      idx++;
    }
  }
  if (idx < positional.length) {
    id = positional[idx].trim();
    idx++;
  }
  if (idx < positional.length) {
    throw new HlasmSyntax(`SAVE has too many positional operands`);
  }

  return { kind: 'SAVE', registers, t, id };
}

function parseReturn(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length > 2) {
    throw new HlasmSyntax(`RETURN expects at most 2 positional operands, got ${positional.length}`);
  }

  let registers = [];
  let t = false;
  if (positional.length > 0) {
    const regRaw = positional[0].trim();
    if (regRaw.startsWith('(') && regRaw.endsWith(')')) {
      const inner = regRaw.slice(1, -1).trim();
      if (inner) {
        registers = inner.split(',').map(s => s.trim());
      }
    } else {
      throw new HlasmSyntax('RETURN first operand must be a parenthesized register list');
    }
  }
  if (positional.length > 1) {
    const next = positional[1].trim().toUpperCase();
    if (next === 'T') {
      t = true;
    } else if (next !== '') {
      throw new HlasmSyntax('RETURN second positional operand must be T or empty');
    }
  }

  const node = { kind: 'RETURN', registers, t, rc: null, keywords: {} };
  for (const [k, v] of keywords) {
    if (!RETURN_KW.has(k)) {
      throw new HlasmSyntax(`RETURN does not accept keyword ${k}`);
    }
    if (k === 'RC') {
      node.rc = v;
    }
    node.keywords[k] = v;
  }
  return node;
}

export const parsers = {
  CALL: parseCall,
  SAVE: parseSave,
  RETURN: parseReturn
};
