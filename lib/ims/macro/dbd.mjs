// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the IMS DBD macros: DBD, DATASET, AREA, SEGM, FIELD, LCHILD, XDFLD, DBDGEN.
import { ImsSyntax, sublist, integer, onlyKeywords } from '../operands.mjs';

const ACCESS_TYPES = new Set(['HDAM', 'HIDAM', 'HISAM', 'HSAM', 'SHISAM', 'SHSAM', 'PHDAM', 'PHIDAM', 'PSINDEX', 'INDEX', 'LOGICAL', 'DEDB', 'MSDB', 'GSAM']);
const ACCESS_METHODS = new Set(['VSAM', 'OSAM', 'BSAM']);
const FIELD_TYPES = new Set(['C', 'X', 'P', 'Z', 'H', 'F', 'G']);

function parseDBD(st, ops) {
  const name = ops.keywords.get('NAME');
  if (!name) throw new ImsSyntax('DBD requires NAME');
  const accessRaw = ops.keywords.get('ACCESS');
  let access = null;
  if (accessRaw) {
    const items = sublist(accessRaw);
    if (!items || items.length < 1 || items.length > 3) throw new ImsSyntax('DBD ACCESS must be a type or (type, method[,prot])');
    const type = items[0].toUpperCase();
    if (!ACCESS_TYPES.has(type)) throw new ImsSyntax(`DBD ACCESS type ${type} is not recognised`);
    let method = null;
    if (items.length >= 2) {
      method = items[1].toUpperCase();
      if (!ACCESS_METHODS.has(method)) throw new ImsSyntax(`DBD ACCESS method ${method} is not recognised`);
    }
    access = { type, method };
  }

  let passwd = null;
  const passwdRaw = ops.keywords.get('PASSWD');
  if (passwdRaw) {
    const p = passwdRaw.toUpperCase();
    if (p !== 'YES' && p !== 'NO') throw new ImsSyntax('DBD PASSWD must be YES or NO');
    passwd = p;
  }

  let rmname = null;
  const rmnameRaw = ops.keywords.get('RMNAME');
  if (rmnameRaw) {
    const items = sublist(rmnameRaw);
    if (!items || items.length < 1 || items.length > 4) throw new ImsSyntax('DBD RMNAME must be (module[,anchors[,rbn[,bytes]]])');
    rmname = items;
  }

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'DBD',
    name,
    access,
    passwd,
    rmname,
    keywords
  };
}

function parseDATASET(st, ops) {
  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  const dd1 = ops.keywords.get('DD1');
  const dd2 = ops.keywords.get('DD2');
  const ovflw = ops.keywords.get('OVFLW');
  const device = ops.keywords.get('DEVICE');
  const sizeRaw = ops.keywords.get('SIZE');
  let size = null;
  if (sizeRaw) {
    const items = sublist(sizeRaw);
    if (items) size = items;
    else size = [sizeRaw];
  }

  return {
    kind: 'DATASET',
    label: st.name,
    dd1,
    dd2,
    ovflw,
    device,
    size,
    keywords
  };
}

function parseAREA(st, ops) {
  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'AREA',
    keywords
  };
}

function parseSEGM(st, ops) {
  const name = ops.keywords.get('NAME');
  if (!name) throw new ImsSyntax('SEGM requires NAME');

  const parentRaw = ops.keywords.get('PARENT');
  let parent = null;
  if (parentRaw) {
    const p = parentRaw.trim();
    if (p === '0') {
      parent = null;
    } else {
      const items = sublist(p);
      if (items && items.length === 1) {
        parent = items[0];
      } else {
        parent = p;
      }
    }
  }

  const bytesRaw = ops.keywords.get('BYTES');
  let bytes = null;
  if (bytesRaw) {
    const items = sublist(bytesRaw);
    if (items) {
      if (items.length === 1) {
        const n = integer(items[0]);
        if (n === null) throw new ImsSyntax('SEGM BYTES must be an integer or (max,min)');
        bytes = { max: n, min: n };
      } else if (items.length === 2) {
        const max = integer(items[0]);
        const min = integer(items[1]);
        if (max === null || min === null) throw new ImsSyntax('SEGM BYTES (max,min) must be integers');
        bytes = { max, min };
      } else {
        throw new ImsSyntax('SEGM BYTES must be an integer or (max,min)');
      }
    } else {
      const n = integer(bytesRaw);
      if (n === null) throw new ImsSyntax('SEGM BYTES must be an integer or (max,min)');
      bytes = { max: n, min: n };
    }
  }

  const rulesRaw = ops.keywords.get('RULES');
  let rules = null;
  if (rulesRaw) {
    rules = sublist(rulesRaw);
  }

  const pointerRaw = ops.keywords.get('POINTER');
  let pointer = null;
  if (pointerRaw) {
    const items = sublist(pointerRaw);
    if (items) pointer = items;
    else pointer = pointerRaw;
  }

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'SEGM',
    name,
    parent,
    bytes,
    rules,
    pointer,
    keywords
  };
}

function parseFIELD(st, ops) {
  const nameRaw = ops.keywords.get('NAME');
  if (!nameRaw) throw new ImsSyntax('FIELD requires NAME');

  const items = sublist(nameRaw);
  let name, seq = false, unique = null;
  if (items) {
    name = items[0];
    if (items.length >= 2) {
      const seqFlag = items[1].toUpperCase();
      if (seqFlag === 'SEQ') seq = true;
      else throw new ImsSyntax('FIELD NAME sublist second element must be SEQ');
    }
    if (items.length >= 3) {
      const uFlag = items[2].toUpperCase();
      if (uFlag === 'U') unique = true;
      else if (uFlag === 'M') unique = false;
      else throw new ImsSyntax('FIELD NAME sublist third element must be U or M');
    }
  } else {
    name = nameRaw;
  }

  const bytesRaw = ops.keywords.get('BYTES');
  let bytes = null;
  if (bytesRaw) {
    const n = integer(bytesRaw);
    if (n === null) throw new ImsSyntax('FIELD BYTES must be an integer');
    bytes = n;
  }

  const startRaw = ops.keywords.get('START');
  let start = null;
  if (startRaw) {
    const n = integer(startRaw);
    if (n === null) throw new ImsSyntax('FIELD START must be an integer');
    start = n;
  }

  const typeRaw = ops.keywords.get('TYPE');
  let type = 'C';
  if (typeRaw) {
    const t = typeRaw.toUpperCase();
    if (!FIELD_TYPES.has(t)) throw new ImsSyntax(`FIELD TYPE ${t} is not recognised`);
    type = t;
  }

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'FIELD',
    name,
    seq,
    unique,
    bytes,
    start,
    type,
    keywords
  };
}

function parseLCHILD(st, ops) {
  const nameRaw = ops.keywords.get('NAME');
  if (!nameRaw) throw new ImsSyntax('LCHILD requires NAME');

  const items = sublist(nameRaw);
  let name, dbd = null;
  if (items) {
    name = items[0];
    if (items.length >= 2) dbd = items[1];
  } else {
    name = nameRaw;
  }

  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'LCHILD',
    name,
    dbd,
    keywords
  };
}

function parseXDFLD(st, ops) {
  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'XDFLD',
    keywords
  };
}

function parseDBDGEN(st, ops) {
  const keywords = {};
  for (const [k, v] of ops.keywords) keywords[k] = v;

  return {
    kind: 'DBDGEN',
    keywords
  };
}

const KEYWORDS = {
  DBD: ['NAME', 'ACCESS', 'RMNAME', 'PASSWD', 'VERSION', 'DATXEXIT', 'EXIT', 'PSNAME', 'GSROOT', 'ENCODING', 'FPINDEX'],
  DATASET: ['DD1', 'DD2', 'OVFLW', 'DEVICE', 'BLOCK', 'SIZE', 'SCAN', 'FRSPC', 'RECORD', 'RECFM', 'MODEL', 'SEARCHA', 'REL'],
  AREA: ['DD1', 'MODEL', 'SIZE', 'UOW', 'ROOT', 'REMOTE'],
  SEGM: ['NAME', 'PARENT', 'BYTES', 'FREQ', 'POINTER', 'PTR', 'RULES', 'COMPRTN', 'EXIT', 'SOURCE', 'SSPTR', 'TYPE', 'DSGROUP'],
  FIELD: ['NAME', 'BYTES', 'START', 'TYPE'],
  LCHILD: ['NAME', 'POINTER', 'PTR', 'PAIR', 'RULES', 'INDEX', 'RKSIZE'],
  XDFLD: ['NAME', 'SEGMENT', 'SRCH', 'SUBSEQ', 'DDATA', 'NULLVAL', 'CONST', 'EXTRTN'],
  DBDGEN: [],
};
const checked = (macro, parse) => (st, ops) => { onlyKeywords(ops, macro, KEYWORDS[macro]); return parse(st, ops); };

export const parsers = Object.freeze({
  DBD: checked('DBD', parseDBD),
  DATASET: checked('DATASET', parseDATASET),
  AREA: checked('AREA', parseAREA),
  SEGM: checked('SEGM', parseSEGM),
  FIELD: checked('FIELD', parseFIELD),
  LCHILD: checked('LCHILD', parseLCHILD),
  XDFLD: checked('XDFLD', parseXDFLD),
  DBDGEN: checked('DBDGEN', parseDBDGEN)
});
