// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the z/OS recovery and dump macros: ESTAE, ESPIE, ABEND, SNAP.
import { HlasmSyntax } from '../operands.mjs';

const ESTAE_KW = new Set(['PARAM', 'XCTL', 'PURGE', 'ASYNCH', 'TERM', 'ASCENV', 'RECORD', 'RELATED', 'MF']);
const ESPIE_KW = new Set(['PKM', 'MF']);
const ABEND_KW = new Set(['REASON', 'DUMPOPT', 'DUMPOPX', 'MF']);
const SNAP_KW = new Set(['DCB', 'TCB', 'ID', 'SDATA', 'PDATA', 'STORAGE', 'LIST', 'STRHDR', 'SUBPLST', 'DSPSTOR', 'MF']);

function checkKw(kw, allowed, op) {
  for (const k of kw.keys()) {
    if (!allowed.has(k)) throw new HlasmSyntax(`${op}: unknown keyword ${k}`);
  }
}

function parseEstae(st, ops) {
  const { positional, keywords } = ops;
  checkKw(keywords, ESTAE_KW, 'ESTAE');
  if (positional.length < 1 || positional.length > 3) {
    throw new HlasmSyntax('ESTAE: expected 1 to 3 positional operands');
  }
  const exit = positional[0];
  for (let i = 1; i < positional.length; i++) {
    const p = positional[i].toUpperCase();
    if (p !== 'CT' && p !== 'OV') {
      throw new HlasmSyntax(`ESTAE: unexpected positional operand ${positional[i]}`);
    }
  }
  return { kind: 'ESTAE', exit, keywords: Object.fromEntries(keywords) };
}

function parseEspie(st, ops) {
  const { positional, keywords } = ops;
  checkKw(keywords, ESPIE_KW, 'ESPIE');
  if (positional.length < 1) throw new HlasmSyntax('ESPIE: missing action');
  const action = positional[0].toUpperCase();
  if (action !== 'SET' && action !== 'RESET' && action !== 'TEST') {
    throw new HlasmSyntax(`ESPIE: invalid action ${positional[0]}`);
  }
  const rest = positional.slice(1);
  if (action === 'SET') {
    if (rest.length > 2) throw new HlasmSyntax('ESPIE SET: too many operands');
  } else if (rest.length > 0) {
    throw new HlasmSyntax(`ESPIE ${action}: no operands expected`);
  }
  return { kind: 'ESPIE', action, operands: rest, keywords: Object.fromEntries(keywords) };
}

function parseAbend(st, ops) {
  const { positional, keywords } = ops;
  checkKw(keywords, ABEND_KW, 'ABEND');
  if (positional.length < 1 || positional.length > 4) {
    throw new HlasmSyntax('ABEND: expected 1 to 4 positional operands');
  }
  const code = positional[0];
  let dump = false, step = false;
  for (let i = 1; i < positional.length; i++) {
    const p = positional[i].toUpperCase();
    if (p === '') continue;
    if (p === 'DUMP') dump = true;
    else if (p === 'STEP') step = true;
    else if (p === 'USER' || p === 'SYSTEM') continue;
    else throw new HlasmSyntax(`ABEND: unexpected positional operand ${positional[i]}`);
  }
  return { kind: 'ABEND', code, dump, step, keywords: Object.fromEntries(keywords) };
}

function parseSnap(st, ops) {
  const { keywords } = ops;
  checkKw(keywords, SNAP_KW, 'SNAP');
  const dcb = keywords.has('DCB') ? keywords.get('DCB') : null;
  return { kind: 'SNAP', dcb, keywords: Object.fromEntries(keywords) };
}

export const parsers = {
  ESTAE: parseEstae,
  ESPIE: parseEspie,
  ABEND: parseAbend,
  SNAP: parseSnap
};
