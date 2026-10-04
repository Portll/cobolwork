// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for z/OS virtual storage macros: STORAGE, GETMAIN, and FREEMAIN.
import { HlasmSyntax } from '../operands.mjs';

const GETMAIN_MODES = new Set(['R', 'RU', 'RC', 'VU', 'VC', 'EU', 'EC', 'LU', 'LC', 'VRC', 'VRU']);
const FREEMAIN_MODES = new Set(['R', 'RU', 'RC', 'VU', 'VC', 'V', 'EU', 'EC', 'E', 'LU', 'LC', 'L']);

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
  if (positional.length < 1) {
    throw new HlasmSyntax('GETMAIN requires a request type');
  }
  const mode = positional[0].trim().toUpperCase();
  if (!GETMAIN_MODES.has(mode)) {
    throw new HlasmSyntax(`GETMAIN request type must be one of ${[...GETMAIN_MODES].join(', ')}, got ${positional[0]}`);
  }
  if (positional.length > 1) {
    throw new HlasmSyntax(`GETMAIN does not accept extra positional operands: ${positional[1]}`);
  }

  const allowed = new Set(['LA', 'LV', 'A', 'SP', 'BNDRY', 'CONTBDY', 'STARTBDY', 'KEY', 'LOC', 'INADDR', 'CHECKZERO', 'RELATED']);
  for (const key of keywords.keys()) {
    if (!allowed.has(key)) {
      throw new HlasmSyntax(`GETMAIN does not accept keyword ${key}`);
    }
  }

  const length = getKeyword(keywords, 'LV') ?? getKeyword(keywords, 'LA');
  const address = getKeyword(keywords, 'A');
  const subpool = getKeyword(keywords, 'SP');

  return {
    kind: 'GETMAIN',
    mode,
    length,
    address,
    subpool,
    keywords: Object.fromEntries(keywords)
  };
}

function parseFreemain(st, ops) {
  const { positional, keywords } = ops;
  if (positional.length < 1) {
    throw new HlasmSyntax('FREEMAIN requires a request type');
  }
  const mode = positional[0].trim().toUpperCase();
  if (!FREEMAIN_MODES.has(mode)) {
    throw new HlasmSyntax(`FREEMAIN request type must be one of ${[...FREEMAIN_MODES].join(', ')}, got ${positional[0]}`);
  }
  if (positional.length > 1) {
    throw new HlasmSyntax(`FREEMAIN does not accept extra positional operands: ${positional[1]}`);
  }

  const allowed = new Set(['LA', 'LV', 'A', 'SP', 'KEY', 'RELATED']);
  for (const key of keywords.keys()) {
    if (!allowed.has(key)) {
      throw new HlasmSyntax(`FREEMAIN does not accept keyword ${key}`);
    }
  }

  const length = getKeyword(keywords, 'LV') ?? getKeyword(keywords, 'LA');
  const address = getKeyword(keywords, 'A');
  const subpool = getKeyword(keywords, 'SP');

  return {
    kind: 'FREEMAIN',
    mode,
    length,
    address,
    subpool,
    keywords: Object.fromEntries(keywords)
  };
}

export const parsers = {
  STORAGE: parseStorage,
  GETMAIN: parseGetmain,
  FREEMAIN: parseFreemain
};
