// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for the z/OS operator-communication macros WTO and WTOR in their standard form.
import { HlasmSyntax } from '../operands.mjs';

// The standard, list and execute forms, authorized keywords included (z/OS 3.1 MVS Programming:
// Authorized Assembler Services Reference, Volume 4, WTO and WTOR).
const WTO_KW = new Set(['TEXT', 'ROUTCDE', 'DESC', 'MCSFLAG', 'MSGTYP', 'CART', 'CONSID', 'CONSNAME', 'KEY', 'TOKEN', 'MF',
  'AREAID', 'CONNECT', 'JOBID', 'JOBNAME', 'LINKAGE', 'SYNCH', 'SYSNAME', 'WSPARM']);
const WTOR_KW = new Set(['TEXT', 'ROUTCDE', 'MCSFLAG', 'DESC', 'MSGTYP', 'RPLYISUR', 'CART', 'CONSID', 'CONSNAME', 'KEY', 'TOKEN', 'MF',
  'JOBID', 'JOBNAME', 'LINKAGE', 'SYNCH', 'SYSNAME']);
const isMessage = (text) => text.startsWith("'") || text.startsWith('(');

function parseWTO(st, ops) {
  const { positional, keywords } = ops;
  const kw = {};
  for (const [k, v] of keywords) {
    if (!WTO_KW.has(k)) throw new HlasmSyntax(`WTO: unknown keyword ${k}`);
    kw[k] = v;
  }
  // A message is one quoted string, or the lines of a multiple-line message, each ('text',type);
  // the execute form (MF=(E,addr)) may leave it to the list form.
  const lines = positional.map((p) => p.trim());
  const execute = /^\(\s*E\s*,/i.test(String(keywords.get('MF') || ''));
  if (lines.length === 1 && lines[0] === '' && execute) return { kind: 'WTO', text: null, keywords: kw };
  for (const line of lines) {
    if (!isMessage(line)) throw new HlasmSyntax('WTO: first positional operand must be a quoted string or a parenthesised list');
  }
  if (lines.length > 1 && !lines.every((l) => l.startsWith('('))) {
    throw new HlasmSyntax(`WTO: too many positional operands (${lines.length})`);
  }
  return { kind: 'WTO', text: lines.length ? lines.join(',') : null, keywords: kw };
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

  // The list form (MF=L) may leave the reply, its length and the ECB to the execute form, and the
  // execute form (MF=(E,addr)) any operand to the list form.
  const mf = String(keywords.get('MF') || '').trim();
  const remote = mf !== '';
  const execute = /^\(\s*E\s*,/i.test(mf);
  if (positional.length === 0) {
    if (!keywords.has('TEXT') && !execute) {
      throw new HlasmSyntax('WTOR: no positional operands and no TEXT= keyword');
    }
  } else if (positional.length === 4 || (remote && positional.length <= 4)) {
    const msg = positional[0].trim();
    if (isMessage(msg)) {
      text = msg;
    } else if (!(msg === '' && (execute || keywords.has('TEXT')))) {
      throw new HlasmSyntax('WTOR: first positional operand must be a quoted string or a parenthesised list');
    }
    reply = positional[1] ?? null;
    replyLength = positional[2] ?? null;
    ecb = positional[3] ?? null;
  } else {
    throw new HlasmSyntax(`WTOR: expected 4 positional operands, got ${positional.length}`);
  }

  return { kind: 'WTOR', text, reply, replyLength, ecb, keywords: kw };
}

export const parsers = {
  WTO: parseWTO,
  WTOR: parseWTOR
};
