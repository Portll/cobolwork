// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for z/OS virtual storage macros: STORAGE, GETMAIN, and FREEMAIN.
import { HlasmSyntax, remoteForm } from '../operands.mjs';

const GETMAIN_MODES = new Set(['R', 'RU', 'RC', 'VU', 'VC', 'EU', 'EC', 'LU', 'LC', 'VRC', 'VRU']);
const FREEMAIN_MODES = new Set(['R', 'RU', 'RC', 'VU', 'VC', 'V', 'EU', 'EC', 'E', 'LU', 'LC', 'L']);
// The request types that have list and execute forms (MF=L, MF=(E,addr)), and those that take
// BRANCH=(YES,GLOBAL) (z/OS 3.1 MVS Programming: Assembler Services Reference, Volume 1, and
// Authorized Assembler Services Reference, Volume 2, GETMAIN and FREEMAIN). The request type is
// optional in both forms: the execute form takes it from the list it names.
const GETMAIN_LIST_MODES = new Set(['LC', 'LU', 'VC', 'VU', 'EC', 'EU']);
const FREEMAIN_LIST_MODES = new Set(['LC', 'LU', 'L', 'VC', 'VU', 'V', 'EC', 'EU', 'E']);
const GETMAIN_GLOBAL_MODES = new Set(['RC', 'RU', 'VRC', 'VRU']);
const FREEMAIN_GLOBAL_MODES = new Set(['RC', 'RU']);
const OWNERS = new Set(['HOME', 'PRIMARY', 'SECONDARY', 'SYSTEM']);

// MF=L or MF=(E,addr), and BRANCH=YES or (YES,GLOBAL), each checked against the request type.
function remoteAndBranch(macro, mode, keywords, listModes, globalModes) {
  const out = {};
  if (keywords.has('MF')) {
    const { form, list } = remoteForm(keywords.get('MF'), 'MF');
    if (mode && !listModes.has(mode)) throw new HlasmSyntax(`${macro} ${mode} has no list or execute form`);
    out.mf = form === 'L' ? 'L' : { form: 'E', list };
  }
  if (keywords.has('BRANCH')) {
    const v = keywords.get('BRANCH').replace(/\s+/g, '').toUpperCase();
    if (v === '(YES,GLOBAL)') {
      if (!globalModes.has(mode)) throw new HlasmSyntax(`${macro} takes BRANCH=(YES,GLOBAL) only with ${[...globalModes].join(', ')}`);
      out.branch = 'GLOBAL';
    } else if (v === 'YES' || v === '(YES)') {
      out.branch = 'YES';
    } else {
      throw new HlasmSyntax(`${macro} BRANCH= value ${keywords.get('BRANCH')} is not YES or (YES,GLOBAL)`);
    }
  }
  return out;
}

function getKeyword(keywords, key) {
  const val = keywords.get(key);
  return val === undefined ? null : val;
}

function parseStorage(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length < 1) {
    throw new HlasmSyntax('STORAGE requires a request type (OBTAIN or RELEASE)');
  }
  const request = positional[0].trim().toUpperCase();
  if (request !== 'OBTAIN' && request !== 'RELEASE') {
    throw new HlasmSyntax(`STORAGE request must be OBTAIN or RELEASE, got ${positional[0]}`);
  }
  if (positional.length > 1) {
    throw new HlasmSyntax(`STORAGE does not accept extra positional operands: ${positional[1]}`);
  }

  const allowed = new Set(['LENGTH', 'ADDR', 'INADDR', 'SP', 'BNDRY', 'CONTBDY', 'STARTBDY', 'KEY', 'CALLRKY', 'LOC', 'LINKAGE', 'RTCD', 'COND', 'CHECKZERO', 'BACK', 'FIX', 'EXECUTABLE', 'RELATED']);
  for (const key of keywords.keys()) {
    if (!allowed.has(key)) {
      throw new HlasmSyntax(`STORAGE does not accept keyword ${key}`);
    }
  }

  return {
    kind: 'STORAGE',
    request,
    length: getKeyword(keywords, 'LENGTH'),
    address: getKeyword(keywords, 'ADDR'),
    subpool: getKeyword(keywords, 'SP'),
    key: getKeyword(keywords, 'KEY'),
    cond: getKeyword(keywords, 'COND'),
    keywords: Object.fromEntries(keywords)
  };
}

function parseGetmain(st, ops) {
  const { positional, keywords } = ops;
  const mode = (positional[0] ?? '').trim().toUpperCase() || null;
  if (!mode && !keywords.has('MF')) {
    throw new HlasmSyntax('GETMAIN requires a request type');
  }
  if (mode && !GETMAIN_MODES.has(mode)) {
    throw new HlasmSyntax(`GETMAIN request type must be one of ${[...GETMAIN_MODES].join(', ')}, got ${positional[0]}`);
  }
  if (positional.length > 1) {
    throw new HlasmSyntax(`GETMAIN does not accept extra positional operands: ${positional[1]}`);
  }

  const allowed = new Set(['LA', 'LV', 'A', 'SP', 'BNDRY', 'CONTBDY', 'STARTBDY', 'KEY', 'LOC', 'INADDR', 'CHECKZERO', 'RELATED', 'MF', 'BRANCH', 'OWNER']);
  for (const key of keywords.keys()) {
    if (!allowed.has(key)) {
      throw new HlasmSyntax(`GETMAIN does not accept keyword ${key}`);
    }
  }
  if (keywords.has('OWNER') && !OWNERS.has(keywords.get('OWNER').trim().toUpperCase())) {
    throw new HlasmSyntax(`GETMAIN OWNER must be one of ${[...OWNERS].join(', ')}`);
  }
  const extra = remoteAndBranch('GETMAIN', mode, keywords, GETMAIN_LIST_MODES, GETMAIN_GLOBAL_MODES);

  const length = getKeyword(keywords, 'LV') ?? getKeyword(keywords, 'LA');
  const address = getKeyword(keywords, 'A');
  const subpool = getKeyword(keywords, 'SP');

  return {
    kind: 'GETMAIN',
    mode,
    length,
    address,
    subpool,
    ...extra,
    keywords: Object.fromEntries(keywords)
  };
}

function parseFreemain(st, ops) {
  const { positional, keywords } = ops;
  const mode = (positional[0] ?? '').trim().toUpperCase() || null;
  if (!mode && !keywords.has('MF')) {
    throw new HlasmSyntax('FREEMAIN requires a request type');
  }
  if (mode && !FREEMAIN_MODES.has(mode)) {
    throw new HlasmSyntax(`FREEMAIN request type must be one of ${[...FREEMAIN_MODES].join(', ')}, got ${positional[0]}`);
  }
  if (positional.length > 1) {
    throw new HlasmSyntax(`FREEMAIN does not accept extra positional operands: ${positional[1]}`);
  }

  const allowed = new Set(['LA', 'LV', 'A', 'SP', 'KEY', 'RELATED', 'MF', 'BRANCH']);
  for (const key of keywords.keys()) {
    if (!allowed.has(key)) {
      throw new HlasmSyntax(`FREEMAIN does not accept keyword ${key}`);
    }
  }
  const extra = remoteAndBranch('FREEMAIN', mode, keywords, FREEMAIN_LIST_MODES, FREEMAIN_GLOBAL_MODES);

  const length = getKeyword(keywords, 'LV') ?? getKeyword(keywords, 'LA');
  const address = getKeyword(keywords, 'A');
  const subpool = getKeyword(keywords, 'SP');

  return {
    kind: 'FREEMAIN',
    mode,
    length,
    address,
    subpool,
    ...extra,
    keywords: Object.fromEntries(keywords)
  };
}

export const parsers = {
  STORAGE: parseStorage,
  GETMAIN: parseGetmain,
  FREEMAIN: parseFreemain
};
