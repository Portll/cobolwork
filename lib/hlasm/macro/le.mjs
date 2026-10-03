// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the Language Environment prolog, epilog and mapping macros.

import { HlasmSyntax } from '../operands.mjs';

const CEEENTRY_KW = new Set(['PPA', 'AUTO', 'NAB', 'MAIN', 'ENCLAVE', 'EXECOPS', 'PARMREG', 'EXPORT', 'BASE', 'PLIST', 'RMODE', 'AMODE', 'STKPROT']);
const CEETERM_KW = new Set(['RC', 'MODIFIER', 'MF']);
const CEEPPA_KW = new Set(['LIBRARY', 'PPA2', 'EXTPROC', 'TSTAMP', 'PEP', 'INSTOP', 'EXITDSA', 'OWNEXM', 'EPNAME', 'VER', 'REL', 'MOD', 'DSA', 'SERVICE', 'VRSMASK', 'VRSLOCR', 'STKPROT']);

function checkKeywords(ops, allowed, op) {
  const keywords = {};
  for (const [k, v] of ops.keywords) {
    if (!allowed.has(k)) throw new HlasmSyntax(`${op} does not take keyword ${k}`);
    keywords[k] = v;
  }
  return keywords;
}

function parseCEEENTRY(st, ops) {
  if (ops.positional.length > 0) throw new HlasmSyntax('CEEENTRY takes no positional operands');
  const keywords = checkKeywords(ops, CEEENTRY_KW, 'CEEENTRY');
  return { kind: 'CEEENTRY', name: st.name, main: keywords.MAIN || null, ppa: keywords.PPA || null, keywords };
}

function parseCEETERM(st, ops) {
  if (ops.positional.length > 0) throw new HlasmSyntax('CEETERM takes no positional operands');
  const keywords = checkKeywords(ops, CEETERM_KW, 'CEETERM');
  return { kind: 'CEETERM', rc: keywords.RC || null, keywords };
}

function parseCEEPPA(st, ops) {
  if (ops.positional.length > 1) throw new HlasmSyntax('CEEPPA takes no positional operands');
  const keywords = checkKeywords(ops, CEEPPA_KW, 'CEEPPA');
  return { kind: 'CEEPPA', name: st.name, keywords };
}

function parseCEECAA(st, ops) {
  if (ops.positional.length > 1 || ops.keywords.size > 0) throw new HlasmSyntax('CEECAA takes no operands');
  return { kind: 'CEECAA', keywords: {} };
}

function parseCEEDSA(st, ops) {
  if (ops.positional.length > 1 || ops.keywords.size > 0) throw new HlasmSyntax('CEEDSA takes no operands');
  return { kind: 'CEEDSA', keywords: {} };
}

export const parsers = {
  CEEENTRY: parseCEEENTRY,
  CEETERM: parseCEETERM,
  CEEPPA: parseCEEPPA,
  CEECAA: parseCEECAA,
  CEEDSA: parseCEEDSA
};
