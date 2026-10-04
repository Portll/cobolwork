// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the z/OS authorization macros MODESET, TESTAUTH, and RACROUTE.
import { HlasmSyntax, NAME } from '../operands.mjs';

const MODESET_EXTKEYS = new Set(['ZERO', 'TCB', 'RBT1', 'RBT234', 'KEY2', 'KEY3', 'KEY4', 'KEY7']);
const MODESET_KEYS = new Set(['ZERO', 'NZERO']);
const MODESET_MODES = new Set(['PROB', 'SUP']);
const MODESET_KNOWN = new Set(['EXTKEY', 'KEYADDR', 'KEYREG', 'SAVEKEY', 'WORKREG', 'RELATED', 'KEY', 'MODE']);

const TESTAUTH_KNOWN = new Set(['FCTN', 'STATE', 'KEY', 'RBLEVEL', 'BRANCH']);
const TESTAUTH_STATES = new Set(['YES', 'NO']);

const RACROUTE_REQUESTS = new Set(['AUTH', 'FASTAUTH', 'DEFINE', 'DIRAUTH', 'EXTRACT', 'LIST', 'SIGNON', 'STAT', 'TOKENBLD', 'TOKENMAP', 'TOKENXTR', 'VERIFY', 'VERIFYX', 'AUDIT']);

function parseModeset(st, ops) {
  const { keywords } = ops;
  const node = { kind: 'MODESET', key: null, mode: null, extkey: null, keywords: {} };

  for (const [k, v] of keywords) {
    if (!MODESET_KNOWN.has(k)) {
      throw new HlasmSyntax(`MODESET: unknown keyword ${k}`);
    }
    node.keywords[k] = v;
  }

  if (keywords.has('EXTKEY')) {
    const v = keywords.get('EXTKEY').trim().toUpperCase();
    if (!MODESET_EXTKEYS.has(v)) {
      throw new HlasmSyntax(`MODESET: invalid EXTKEY value ${v}`);
    }
    node.extkey = v;
  }

  if (keywords.has('KEY')) {
    const v = keywords.get('KEY').trim().toUpperCase();
    if (!MODESET_KEYS.has(v)) {
      throw new HlasmSyntax(`MODESET: invalid KEY value ${v}`);
    }
    node.key = v;
  }

  if (keywords.has('MODE')) {
    const v = keywords.get('MODE').trim().toUpperCase();
    if (!MODESET_MODES.has(v)) {
      throw new HlasmSyntax(`MODESET: invalid MODE value ${v}`);
    }
    node.mode = v;
  }

  return node;
}

function parseTestauth(st, ops) {
  const { keywords } = ops;
  const node = { kind: 'TESTAUTH', keywords: {} };

  for (const [k, v] of keywords) {
    if (!TESTAUTH_KNOWN.has(k)) {
      throw new HlasmSyntax(`TESTAUTH: unknown keyword ${k}`);
    }
    node.keywords[k] = v;
  }

  if (keywords.has('STATE')) {
    const v = keywords.get('STATE').trim().toUpperCase();
    if (!TESTAUTH_STATES.has(v)) {
      throw new HlasmSyntax(`TESTAUTH: invalid STATE value ${v}`);
    }
  }

  if (keywords.has('KEY')) {
    const v = keywords.get('KEY').trim().toUpperCase();
    if (!TESTAUTH_STATES.has(v)) {
      throw new HlasmSyntax(`TESTAUTH: invalid KEY value ${v}`);
    }
  }

  if (keywords.has('RBLEVEL')) {
    const v = keywords.get('RBLEVEL').trim();
    if (v !== '1' && v !== '2') {
      throw new HlasmSyntax(`TESTAUTH: invalid RBLEVEL value ${v}`);
    }
  }

  if (keywords.has('BRANCH')) {
    const v = keywords.get('BRANCH').trim().toUpperCase();
    if (!TESTAUTH_STATES.has(v)) {
      throw new HlasmSyntax(`TESTAUTH: invalid BRANCH value ${v}`);
    }
  }

  return node;
}

function parseRacroute(st, ops) {
  const { keywords } = ops;
  const node = { kind: 'RACROUTE', request: null, class: null, entity: null, attr: null, keywords: {} };

  const req = keywords.get('REQUEST');
  if (!req) {
    throw new HlasmSyntax('RACROUTE: REQUEST is required');
  }
  const reqVal = req.trim().toUpperCase();
  if (!RACROUTE_REQUESTS.has(reqVal)) {
    throw new HlasmSyntax(`RACROUTE: invalid REQUEST value ${reqVal}`);
  }
  node.request = reqVal;

  for (const [k, v] of keywords) {
    if (!NAME.test(k)) {
      throw new HlasmSyntax(`RACROUTE: invalid keyword name ${k}`);
    }
    node.keywords[k] = v;
    if (k === 'CLASS') node.class = v;
    if (k === 'ENTITY') node.entity = v;
    if (k === 'ATTR') node.attr = v;
  }

  return node;
}

export const parsers = {
  MODESET: parseModeset,
  TESTAUTH: parseTestauth,
  RACROUTE: parseRacroute
};
