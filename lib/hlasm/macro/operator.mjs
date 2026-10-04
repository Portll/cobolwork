// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for the z/OS operator-communication macros WTO and WTOR in their standard form.
import { HlasmSyntax } from '../operands.mjs';

const WTO_KW = new Set(['TEXT', 'ROUTCDE', 'DESC', 'MCSFLAG', 'MSGTYP', 'CART', 'CONSID', 'CONSNAME', 'KEY', 'TOKEN', 'MF']);
const WTOR_KW = new Set(['TEXT', 'ROUTCDE', 'MCSFLAG', 'DESC', 'MSGTYP', 'RPLYISUR', 'CART', 'CONSID', 'CONSNAME', 'KEY', 'TOKEN', 'MF']);

function parseWTO(st, ops) {
  const { positional, keywords } = ops;
  const kw = {};
  for (const [k, v] of keywords) {
    if (!WTO_KW.has(k)) throw new HlasmSyntax(`WTO: unknown keyword ${k}`);
    kw[k] = v;
  }
  let text = null;
  if (positional.length > 0) {
    const first = positional[0].trim();
    if (first.startsWith("'") || first.startsWith('(')) {
      text = first;
    } else {
      throw new HlasmSyntax('WTO: first positional operand must be a quoted string or a parenthesised list');
    }
  }
  if (positional.length > 1) {
    throw new HlasmSyntax(`WTO: too many positional operands (${positional.length})`);
  }
  return { kind: 'WTO', text, keywords: kw };
}

function parseWTOR(st, ops) {
  const { positional, keywords } = ops;
  const kw = {};
  for (const [k, v] of keywords) {
    if (!WTOR_KW.has(k)) throw new HlasmSyntax(`WTOR: unknown keyword ${k}`);
    kw[k] = v;
  }
  let text = null;
  let reply = null;
  let replyLength = null;
  let ecb = null;

  if (positional.length === 0) {
    if (!keywords.has('TEXT')) {
      throw new HlasmSyntax('WTOR: no positional operands and no TEXT= keyword');
    }
  } else if (positional.length === 4) {
    const msg = positional[0].trim();
    if (msg.startsWith("'") || msg.startsWith('(')) {
      text = msg;
    } else {
      throw new HlasmSyntax('WTOR: first positional operand must be a quoted string or a parenthesised list');
    }
    reply = positional[1];
    replyLength = positional[2];
    ecb = positional[3];
  } else {
    throw new HlasmSyntax(`WTOR: expected 4 positional operands, got ${positional.length}`);
  }

  return { kind: 'WTOR', text, reply, replyLength, ecb, keywords: kw };
}

export const parsers = {
  WTO: parseWTO,
  WTOR: parseWTOR
};
