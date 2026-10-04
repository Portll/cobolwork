// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the IMS PSB macros: PCB (TYPE=TP, DB or GSAM), SENSEG, SENFLD and PSBGEN, after IMS 15.6
// System Utilities, "Program Specification Block (PSB) Generation utility", and its PSBGEN messages.
import { ImsSyntax, sublist, integer, onlyKeywords } from '../operands.mjs';

const DB_PROCOPT = new Set('AGIRDPONTELSH');
const SENSEG_PROCOPT = new Set('GIRDAEPK');
const GSAM_PROCOPT = ['G', 'GS', 'L', 'LS'];
// O, N and T are written only in these forms (the PCB syntax diagram; the O, N, T and H rules).
const READ_WITHOUT_INTEGRITY = ['GO', 'GOP', 'GON', 'GONP', 'GOT', 'GOTP'];
// PGEN110 adds PLI and PL1 to the statement page's list.
const LANGS = ['COBOL', 'PL/I', 'PLI', 'PL1', 'ASSEM', 'PASCAL', 'JAVA', ''];
const POSITIONS = { SINGLE: 'SINGLE', S: 'SINGLE', MULTIPLE: 'MULTIPLE', M: 'MULTIPLE' };

const upper = (v) => (v == null ? null : String(v).trim().toUpperCase());
const value = (ops, key) => ops.keywords.get(key) || null;

function oneOf(macro, ops, key, allowed) {
  const v = upper(ops.keywords.get(key));
  if (v == null) return null;
  if (!allowed.includes(v)) throw new ImsSyntax(`${macro} ${key} must be ${allowed.join(' or ')}`);
  return v;
}

// YES or NO as a boolean, and the reference's default when the operand is absent.
const yesNo = (macro, ops, key, absent) => { const v = oneOf(macro, ops, key, ['YES', 'NO']); return v == null ? absent : v === 'YES'; };

function number(macro, ops, key, min, max) {
  const raw = ops.keywords.get(key);
  if (raw == null) return null;
  const n = integer(raw);
  if (n === null || n < min || n > max) throw new ImsSyntax(`${macro} ${key} must be an integer from ${min} to ${max}`);
  return n;
}

function short(macro, what, v, most = 8) {
  if (v != null && v.length > most) throw new ImsSyntax(`${macro} ${what} ${v} is longer than ${most} characters`);
  return v;
}

// A PCB's own name, from its label or PCBNAME: at most 8 characters, and DFS is IMS's prefix.
function pcbName(macro, what, v) {
  short(macro, what, v);
  if (v && v.startsWith('DFS')) throw new ImsSyntax(`${macro} ${what} ${v} begins with DFS, which is reserved for IMS`);
  return v;
}

// The letters as written; each must be a processing option the statement takes, at most four (the
// catalog holds PROCOPT in four bytes for a PCB and for a SENSEG).
function procopt(macro, ops, letters) {
  const v = upper(ops.keywords.get('PROCOPT'));
  if (v == null) return null;
  if (!v) throw new ImsSyntax(`${macro} PROCOPT is empty`);
  for (const c of v) if (!letters.has(c)) throw new ImsSyntax(`${macro} PROCOPT ${v}: ${c} is not a processing option it takes`);
  if (v.length > 4) throw new ImsSyntax(`${macro} PROCOPT ${v} has more than 4 options`);
  return v;
}

const PCB_KEYWORDS = {
  TP: ['TYPE', 'LTERM', 'NAME', 'ALTRESP', 'SAMETRM', 'MODIFY', 'EXPRESS', 'PCBNAME', 'EXTERNALNAME', 'LIST', 'REMARKS'],
  DB: ['TYPE', 'DBDNAME', 'NAME', 'DBVER', 'PCBNAME', 'EXTERNALNAME', 'PROCOPT', 'SB', 'KEYLEN', 'PROCSEQ', 'PROCSEQD', 'PSELOPT', 'ACCESS', 'VIEW', 'LIST', 'REMARKS', 'POS'],
  GSAM: ['TYPE', 'DBDNAME', 'NAME', 'PROCOPT', 'PCBNAME', 'EXTERNALNAME', 'LIST', 'REMARKS'],
};

function parsePCB(st, ops) {
  const type = upper(ops.keywords.get('TYPE'));
  if (!type) throw new ImsSyntax('PCB requires TYPE');
  if (!PCB_KEYWORDS[type]) throw new ImsSyntax(`PCB TYPE ${type} is not TP, DB or GSAM`);
  const macro = `PCB TYPE=${type}`;
  onlyKeywords(ops, macro, PCB_KEYWORDS[type]);

  const label = pcbName(macro, 'label', st.name || null);
  const pcbname = pcbName(macro, 'PCBNAME', value(ops, 'PCBNAME'));
  if (label && pcbname) {
    if (type !== 'DB') throw new ImsSyntax(`${macro} takes a label or PCBNAME, not both`);
    if (label !== pcbname) throw new ImsSyntax(`${macro} label ${label} and PCBNAME ${pcbname} must be the same name`);
  }
  const name = label || pcbname;
  const list = yesNo(macro, ops, 'LIST', true);
  if (!list && !name) throw new ImsSyntax(`${macro} LIST=NO needs the PCB named by a label or PCBNAME`);

  const named = ['LTERM', 'DBDNAME', 'NAME'].filter((k) => ops.keywords.has(k));
  if (named.length > 1) throw new ImsSyntax(`${macro} takes one of ${named.join(' and ')}`);
  for (const k of named) short(macro, k, value(ops, k));

  const externalname = value(ops, 'EXTERNALNAME');
  short(macro, 'EXTERNALNAME', externalname, 128);
  if (externalname && externalname.startsWith('DFS')) throw new ImsSyntax(`${macro} EXTERNALNAME ${externalname} begins with DFS`);

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;
  const common = { kind: 'PCB', type, name, label, pcbname, externalname, list };

  if (type === 'TP') {
    const modify = yesNo(macro, ops, 'MODIFY', false);
    const lterm = value(ops, 'LTERM');
    const transaction = value(ops, 'NAME');
    if (modify && (lterm || transaction)) throw new ImsSyntax(`${macro} MODIFY=YES takes no LTERM or NAME`);
    if (!lterm && !transaction && !modify) throw new ImsSyntax(`${macro} requires LTERM or NAME unless MODIFY=YES`);
    const destination = lterm ? { kind: 'LTERM', name: lterm } : transaction ? { kind: 'TRANSACTION', name: transaction } : null;
    return {
      ...common,
      destination,
      altresp: yesNo(macro, ops, 'ALTRESP', false),
      sametrm: yesNo(macro, ops, 'SAMETRM', false),
      modify,
      express: yesNo(macro, ops, 'EXPRESS', false),
      keywords
    };
  }

  const dbd = value(ops, 'DBDNAME') || value(ops, 'NAME');
  if (!dbd) throw new ImsSyntax(`${macro} requires DBDNAME or NAME`);

  if (type === 'GSAM') {
    if (!ops.keywords.has('PROCOPT')) throw new ImsSyntax(`${macro} requires PROCOPT`);
    return { ...common, dbd, procopt: oneOf(macro, ops, 'PROCOPT', GSAM_PROCOPT), keywords };
  }

  const procseqd = value(ops, 'PROCSEQD');
  for (const k of ['PSELOPT', 'ACCESS']) if (ops.keywords.has(k) && !procseqd) throw new ImsSyntax(`${macro} ${k} is valid only with PROCSEQD`);
  const posRaw = upper(ops.keywords.get('POS'));
  if (posRaw != null && !POSITIONS[posRaw]) throw new ImsSyntax(`${macro} POS must be SINGLE, S, MULTIPLE or M`);
  if (!ops.keywords.has('KEYLEN')) throw new ImsSyntax(`${macro} requires KEYLEN`);
  const letters = procopt(macro, ops, DB_PROCOPT);
  if (letters && /[ONT]/.test(letters) && !READ_WITHOUT_INTEGRITY.includes(letters)) throw new ImsSyntax(`${macro} PROCOPT ${letters}: O, N and T are written only as ${READ_WITHOUT_INTEGRITY.join(', ')}`);

  return {
    ...common,
    dbd,
    dbver: number(macro, ops, 'DBVER', 0, 2147483647),
    procopt: letters,
    keylen: number(macro, ops, 'KEYLEN', 0, 32767),
    pos: posRaw == null ? null : POSITIONS[posRaw],
    procseq: short(macro, 'PROCSEQ', value(ops, 'PROCSEQ')),
    procseqd,
    pselopt: oneOf(macro, ops, 'PSELOPT', ['MULT', 'SNGL']),
    access: pcbAccess(macro, ops),
    sb: oneOf(macro, ops, 'SB', ['NO', 'COND']),
    view: oneOf(macro, ops, 'VIEW', ['MSDB', 'MSDBL']),
    keywords
  };
}

// ACCESS=DB or ACCESS=INDEX (PCB237), INDEX also written (INDEX,VSAM) or (INDEX,SHISAM) on the statement page.
function pcbAccess(macro, ops) {
  const raw = ops.keywords.get('ACCESS');
  if (raw == null) return null;
  const items = sublist(raw).map((x) => x.toUpperCase());
  const bare = !raw.trim().startsWith('(');
  if (bare && items.length === 1 && (items[0] === 'DB' || items[0] === 'INDEX')) return { type: items[0], method: null };
  if (!bare && items.length === 2 && items[0] === 'INDEX' && (items[1] === 'VSAM' || items[1] === 'SHISAM')) return { type: 'INDEX', method: items[1] };
  throw new ImsSyntax(`${macro} ACCESS must be DB, INDEX, (INDEX,VSAM) or (INDEX,SHISAM)`);
}

function parseSENSEG(st, ops) {
  const name = short('SENSEG', 'NAME', value(ops, 'NAME'));
  if (!name) throw new ImsSyntax('SENSEG requires NAME');
  const parentRaw = ops.keywords.get('PARENT');
  if (parentRaw != null && !parentRaw.trim()) throw new ImsSyntax('SENSEG PARENT must be 0 or a segment name');
  const parent = parentRaw == null || parentRaw.trim() === '0' ? null : short('SENSEG', 'PARENT', parentRaw.trim());

  let indices = null;
  const indicesRaw = ops.keywords.get('INDICES');
  if (indicesRaw != null) {
    indices = sublist(indicesRaw);
    if (indices.some((x) => !x)) throw new ImsSyntax('SENSEG INDICES must be a secondary index name or a list of them');
    if (indices.length > 32) throw new ImsSyntax('SENSEG INDICES names more than 32 secondary indexes');
    for (const x of indices) short('SENSEG', 'INDICES name', x);
  }

  const letters = procopt('SENSEG', ops, SENSEG_PROCOPT);
  const ssptr = subsetPointers(ops.keywords.get('SSPTR'));
  if (ssptr && !parent) throw new ImsSyntax('SENSEG SSPTR is not supported on a root segment');
  if (ssptr && letters && !/[ARID]/.test(letters)) {
    const u = ssptr.find((p) => p.sensitivity === 'U');
    if (u) throw new ImsSyntax(`SENSEG SSPTR pointer ${u.pointer} is update-sensitive, which PROCOPT ${letters} does not allow`);
  }

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;
  return { kind: 'SENSEG', name, parent, procopt: letters, ssptr, indices, keywords };
}

// SSPTR=((n[,R|U]),...): up to eight subset pointers numbered 1 to 8, read-sensitive unless U is given.
function subsetPointers(raw) {
  if (raw == null) return null;
  const shape = 'SENSEG SSPTR must be ((n[,R|U]),...)';
  if (!raw.trim().startsWith('(')) throw new ImsSyntax(shape);
  const entries = sublist(raw);
  if (entries.length > 8) throw new ImsSyntax('SENSEG SSPTR defines more than 8 subset pointers');
  return entries.map((e) => {
    if (!e.startsWith('(')) throw new ImsSyntax(shape);
    const [n, sensitivity = 'R', ...rest] = sublist(e).map((x) => x.toUpperCase());
    const pointer = integer(n);
    if (rest.length || pointer === null || pointer < 1 || pointer > 8) throw new ImsSyntax('SENSEG SSPTR pointer number must be 1 to 8');
    if (sensitivity !== 'R' && sensitivity !== 'U') throw new ImsSyntax('SENSEG SSPTR sensitivity must be R or U');
    return { pointer, sensitivity };
  });
}

function parseSENFLD(st, ops) {
  const name = short('SENFLD', 'NAME', value(ops, 'NAME'));
  if (!name) throw new ImsSyntax('SENFLD requires NAME');
  if (!ops.keywords.has('START')) throw new ImsSyntax('SENFLD requires START');
  if (ops.keywords.has('REPLACE') && ops.keywords.has('REPL')) throw new ImsSyntax('SENFLD takes REPLACE or REPL, not both');
  const key = ops.keywords.has('REPL') ? 'REPL' : 'REPLACE';
  const replace = oneOf('SENFLD', ops, key, ['YES', 'Y', 'NO', 'N']);

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;
  return {
    kind: 'SENFLD',
    name,
    start: number('SENFLD', ops, 'START', 1, 32767),
    replace: replace == null || replace.startsWith('Y'),
    keywords
  };
}

function parsePSBGEN(st, ops) {
  const psbname = short('PSBGEN', 'PSBNAME', value(ops, 'PSBNAME'));
  if (!psbname) throw new ImsSyntax('PSBGEN requires PSBNAME');
  const langRaw = upper(ops.keywords.get('LANG'));
  if (langRaw != null && !LANGS.includes(langRaw)) throw new ImsSyntax('PSBGEN LANG must be COBOL, PL/I, PLI, PL1, ASSEM, PASCAL, JAVA or blank');

  let ioeropn = null;
  const ioeropnRaw = ops.keywords.get('IOEROPN');
  if (ioeropnRaw != null) {
    const parened = ioeropnRaw.trim().startsWith('(');
    const items = sublist(ioeropnRaw).map((x) => x.toUpperCase());
    const code = integer(items[0]);
    const wtor = parened && items.length === 2 && items[1] === 'WTOR';
    if (code === null || code > 4095 || (parened ? !wtor : items.length !== 1)) throw new ImsSyntax('PSBGEN IOEROPN must be n or (n,WTOR), n from 0 to 4095');
    ioeropn = { code, wtor };
  }

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;
  return {
    kind: 'PSBGEN',
    psbname,
    dblevel: oneOf('PSBGEN', ops, 'DBLEVEL', ['CURR', 'BASE']),
    lang: langRaw,
    maxq: number('PSBGEN', ops, 'MAXQ', 0, 32767),
    cmpat: yesNo('PSBGEN', ops, 'CMPAT', false),
    ioasize: number('PSBGEN', ops, 'IOASIZE', 0, 256000),
    ssasize: number('PSBGEN', ops, 'SSASIZE', 0, 256000),
    ioeropn,
    olic: yesNo('PSBGEN', ops, 'OLIC', false),
    gsrolbok: yesNo('PSBGEN', ops, 'GSROLBOK', false),
    lockmax: number('PSBGEN', ops, 'LOCKMAX', 0, 255),
    keywords
  };
}

// REMARKS is 1 to 256 characters inside its quotes, with no double quote, <, > or &.
function remarks(macro, ops) {
  const raw = ops.keywords.get('REMARKS');
  if (raw == null) return;
  const text = /^'([\s\S]*)'$/.exec(raw.trim())?.[1] ?? raw.trim();
  if (!text || text.length > 256) throw new ImsSyntax(`${macro} REMARKS must be 1 to 256 characters`);
  if (/["<>&]/.test(text)) throw new ImsSyntax(`${macro} REMARKS cannot contain a double quote, <, > or &`);
}

const KEYWORDS = {
  SENSEG: ['NAME', 'PARENT', 'PROCOPT', 'SSPTR', 'INDICES', 'REMARKS'],
  SENFLD: ['NAME', 'START', 'REPLACE', 'REPL', 'REMARKS'],
  PSBGEN: ['PSBNAME', 'DBLEVEL', 'LANG', 'MAXQ', 'CMPAT', 'IOASIZE', 'SSASIZE', 'IOEROPN', 'OLIC', 'GSROLBOK', 'LOCKMAX', 'REMARKS'],
};

// An operand field that ends in a comma was meant to go on, but the next card was not read as its
// continuation (no column-72 mark), so operands such as PROCOPT never reached the parser.
const read = (macro, parse) => (st, ops) => {
  if (/,\s*$/.test(st.field)) throw new ImsSyntax(`${macro} operands end in a comma: the operands meant to follow were not read as a continuation`);
  if (KEYWORDS[macro]) onlyKeywords(ops, macro, KEYWORDS[macro]);
  remarks(macro, ops);
  return parse(st, ops);
};

export const parsers = Object.freeze({
  PCB: read('PCB', parsePCB),
  SENSEG: read('SENSEG', parseSENSEG),
  SENFLD: read('SENFLD', parseSENFLD),
  PSBGEN: read('PSBGEN', parsePSBGEN)
});
