// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the z/OS record macros GET, PUT, READ, and WRITE in their standard forms.
import { HlasmSyntax, NAME } from '../operands.mjs';
import { parseExpression, parseAddress } from '../expr.mjs';

const REG = /^\(\d{1,2}\)$/;
const MF_VAL = /^(L|\((E|M),\s*[A-Z$#@_][A-Z0-9$#@_]*\))$/i;

function parseAddr(text, label) {
  const t = text.trim();
  if (t === '') throw new HlasmSyntax(`${label} is missing`);
  if (REG.test(t)) return t;
  try {
    parseAddress(t);
  } catch (e) {
    throw new HlasmSyntax(`${label} is not a valid address: ${e.message}`);
  }
  return t;
}

function parseLen(text, label) {
  const t = text.trim();
  if (t === '') throw new HlasmSyntax(`${label} is missing`);
  if (t === "'S'") return t;
  try {
    parseExpression(t);
  } catch (e) {
    throw new HlasmSyntax(`${label} is not a valid length: ${e.message}`);
  }
  return t;
}

function parseMf(text) {
  const t = text.trim();
  if (!MF_VAL.test(t)) throw new HlasmSyntax(`MF= value ${t} is not L, (E,addr) or (M,addr)`);
  return t;
}

function parseGet(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length > 2) throw new HlasmSyntax('GET takes at most 2 positional operands');
  if (positional.length === 0) throw new HlasmSyntax('GET requires a dcb address');
  
  const dcb = parseAddr(positional[0], 'dcb address');
  const area = positional.length > 1 ? parseAddr(positional[1], 'area address') : null;
  
  const node = { kind: 'GET', dcb, area };
  const allowed = new Set(['TYPE', 'MF']);
  for (const [k, v] of keywords) {
    if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k} in GET`);
    if (k === 'TYPE') {
      if (v.trim().toUpperCase() !== 'P') throw new HlasmSyntax('GET TYPE= must be P');
      node.type = v;
    } else if (k === 'MF') {
      node.mf = parseMf(v);
    }
  }
  return node;
}

function parsePut(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length > 2) throw new HlasmSyntax('PUT takes at most 2 positional operands');
  if (positional.length === 0) throw new HlasmSyntax('PUT requires a dcb address');
  
  const dcb = parseAddr(positional[0], 'dcb address');
  const area = positional.length > 1 ? parseAddr(positional[1], 'area address') : null;
  
  const node = { kind: 'PUT', dcb, area };
  const allowed = new Set(['MF']);
  for (const [k, v] of keywords) {
    if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k} in PUT`);
    if (k === 'MF') {
      node.mf = parseMf(v);
    }
  }
  return node;
}

function parseRead(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length < 4) throw new HlasmSyntax('READ requires decb, type, dcb, and area');
  if (positional.length > 5) throw new HlasmSyntax('READ takes at most 5 positional operands');
  
  const decb = positional[0].trim();
  if (!NAME.test(decb)) throw new HlasmSyntax('READ decb name is not a valid symbol');
  
  const type = positional[1].trim().toUpperCase();
  if (!['SF', 'SB', 'SF64', 'SF64P'].includes(type)) throw new HlasmSyntax(`READ type ${type} is not SF, SB, SF64, or SF64P`);
  
  const dcb = parseAddr(positional[2], 'dcb address');
  const area = parseAddr(positional[3], 'area address');
  const length = positional.length > 4 ? parseLen(positional[4], 'length') : null;
  
  const node = { kind: 'READ', decb, type, dcb, area, length, keywords: {} };
  const allowed = new Set(['MF']);
  for (const [k, v] of keywords) {
    if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k} in READ`);
    if (k === 'MF') {
      node.mf = parseMf(v);
      node.keywords.MF = v;
    }
  }
  return node;
}

function parseWrite(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length < 4) throw new HlasmSyntax('WRITE requires decb, type, dcb, and area');
  if (positional.length > 5) throw new HlasmSyntax('WRITE takes at most 5 positional operands');
  
  const decb = positional[0].trim();
  if (!NAME.test(decb)) throw new HlasmSyntax('WRITE decb name is not a valid symbol');
  
  const type = positional[1].trim().toUpperCase();
  if (!['SF', 'SF64', 'SF64P'].includes(type)) throw new HlasmSyntax(`WRITE type ${type} is not SF, SF64, or SF64P`);
  
  const dcb = parseAddr(positional[2], 'dcb address');
  const area = parseAddr(positional[3], 'area address');
  const length = positional.length > 4 ? parseLen(positional[4], 'length') : null;
  
  const node = { kind: 'WRITE', decb, type, dcb, area, length, keywords: {} };
  const allowed = new Set(['MF']);
  for (const [k, v] of keywords) {
    if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k} in WRITE`);
    if (k === 'MF') {
      node.mf = parseMf(v);
      node.keywords.MF = v;
    }
  }
  return node;
}

export const parsers = {
  GET: parseGet,
  PUT: parsePut,
  READ: parseRead,
  WRITE: parseWrite
};
