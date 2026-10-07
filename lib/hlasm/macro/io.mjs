// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the z/OS record macros GET, PUT, READ, and WRITE in their standard forms.
import { HlasmSyntax, NAME } from '../operands.mjs';
import { parseExpression, parseAddress } from '../expr.mjs';
import { MVS38_BTAM_TYPES, MVS38_VTAM_RPL_KEYWORDS, mvs38Form } from '../mvs38.mjs';

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

// VSAM's GET and PUT name only a request parameter list (z/OS 3.1 DFSMS Macro Instructions for
// Data Sets, GET and PUT for VSAM): RPL=address, register notation from 1 to 12 included.
function vsamRequest(macro, ops) {
  const { positional, keywords } = ops;
  if (positional.some((p) => p.trim() !== '')) throw new HlasmSyntax(`${macro} RPL= takes no positional operands`);
  for (const k of keywords.keys()) if (k !== 'RPL') throw new HlasmSyntax(`unknown keyword ${k} in ${macro} RPL=`);
  return { kind: macro, rpl: parseAddr(keywords.get('RPL'), 'RPL address') };
}

function parseGet(st, ops) {
  if (ops.keywords.has('RPL')) return vsamRequest('GET', ops);
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
  if (ops.keywords.has('RPL')) return vsamRequest('PUT', ops);
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

// READ and WRITE name a data event control block, a type, then by position the dcb, area, length,
// key and block addresses and a next address (z/OS 3.1 DFSMS Macro Instructions for Data Sets: BSAM
// and BPAM, BDAM, BISAM, and BSAM creating a direct data set). The standard form names the DECB and
// needs the dcb and area; the list form (MF=L) may leave any operand after the type to the execute
// form, and the execute form (MF=E) names an existing DECB by address and may omit them too.
const BLOCK_TYPES = {
  READ: /^(?:SF|SB|SF64P?|K|KU|D[IK][FX]?(?:R|RU)?)$/,
  WRITE: /^(?:SF|SFR|SD|SZ|SF64P?|K|KN|DAF?|D[IK][FX]?)$/,
};
const BLOCK_FIELDS = ['dcb', 'area', 'length', 'key', 'block', 'next'];
const REGISTER = /^\(\s*[A-Z0-9$#@_]+\s*\)$/i;

function blockField(field, raw) {
  if (raw === "'S'" || (field === 'key' && raw === '0') || REGISTER.test(raw)) return raw;
  return field === 'length' ? parseLen(raw, 'length') : parseAddr(raw, `${field} address`);
}

// VTAM's basic-mode READ and WRITE: RPL= and the request parameter list fields, no positional operands.
function vtamBasicRequest(macro, ops, opts) {
  const node = { kind: macro };
  mvs38Form(opts, node, macro, 'RPL=');
  if (ops.positional.some((p) => p.trim() !== '')) throw new HlasmSyntax(`${macro} RPL= takes no positional operands`);
  for (const k of ops.keywords.keys()) if (!MVS38_VTAM_RPL_KEYWORDS.has(k)) throw new HlasmSyntax(`unknown keyword ${k} in ${macro} RPL=`);
  return { ...node, rpl: parseAddr(ops.keywords.get('RPL'), 'RPL address'), keywords: Object.fromEntries(ops.keywords) };
}

function blockRequest(macro, st, ops, opts) {
  const { positional, keywords } = ops;
  if (keywords.has('RPL')) return vtamBasicRequest(macro, ops, opts);
  for (const k of keywords.keys()) if (k !== 'MF') throw new HlasmSyntax(`unknown keyword ${k} in ${macro}`);
  const legacy = {};
  let mf = keywords.has('MF') ? keywords.get('MF').trim().toUpperCase() : null;
  let list = null;
  const remote = mf && /^\(\s*E\s*,(.+)\)$/.exec(mf);
  if (remote) {
    mvs38Form(opts, legacy, macro, 'MF=(E,addr)');
    list = parseAddr(remote[1], 'MF list address');
    mf = 'E';
  }
  if (mf !== null && mf !== 'L' && mf !== 'E') throw new HlasmSyntax(`${macro} MF= value ${mf} is not L or E`);
  if (positional.length < 2) throw new HlasmSyntax(`${macro} requires a decb and a type`);
  if (positional.length > 2 + BLOCK_FIELDS.length) throw new HlasmSyntax(`${macro} takes at most ${2 + BLOCK_FIELDS.length} positional operands`);
  const decb = positional[0].trim();
  if (mf === 'E' ? decb === '' || !(REGISTER.test(decb) || parseAddr(decb, 'decb address')) : !NAME.test(decb)) {
    throw new HlasmSyntax(`${macro} decb name is not a valid symbol`);
  }
  const type = positional[1].trim().toUpperCase();
  if (MVS38_BTAM_TYPES[macro].has(type) && (type !== 'T' || mf === 'E')) mvs38Form(opts, legacy, macro, `type ${type}`);
  else if (!BLOCK_TYPES[macro].test(type)) throw new HlasmSyntax(`${macro} type ${type} is not one the access methods define`);
  const node = { kind: macro, ...legacy, decb, type, mf, ...(list ? { list } : {}), keywords: Object.fromEntries(keywords) };
  BLOCK_FIELDS.forEach((field, i) => {
    const raw = (positional[i + 2] ?? '').trim();
    if (raw === '') {
      if (!mf && (field === 'dcb' || field === 'area')) throw new HlasmSyntax(`${field} address is missing`);
      node[field] = null;
    } else {
      node[field] = blockField(field, raw);
    }
  });
  return node;
}

const parseRead = (st, ops, opts) => blockRequest('READ', st, ops, opts);
const parseWrite = (st, ops, opts) => blockRequest('WRITE', st, ops, opts);

export const parsers = {
  GET: parseGet,
  PUT: parsePut,
  READ: parseRead,
  WRITE: parseWrite
};
