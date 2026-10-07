// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for the z/OS authorization macros MODESET, TESTAUTH, and RACROUTE.
import { HlasmSyntax, NAME, remoteForm } from '../operands.mjs';
import { MVS38_EXTKEYS, mvs38Form } from '../mvs38.mjs';

const MODESET_EXTKEYS = new Set(['ZERO', 'TCB', 'RBT1', 'RBT234', 'KEY2', 'KEY3', 'KEY4', 'KEY7']);
const MODESET_KEYS = new Set(['ZERO', 'NZERO']);
const MODESET_MODES = new Set(['PROB', 'SUP']);
const MODESET_KNOWN = new Set(['EXTKEY', 'KEYADDR', 'KEYREG', 'SAVEKEY', 'WORKREG', 'RELATED', 'KEY', 'MODE', 'MF']);
// The list and execute forms of the MODESET that generates an SVC (z/OS 3.1 MVS Programming:
// Authorized Assembler Services Reference, Volume 3): the list form holds KEY and MODE, the execute
// form names the list.
const MODESET_LIST_KNOWN = new Set(['KEY', 'MODE', 'RELATED', 'MF']);
const MODESET_EXECUTE_KNOWN = new Set(['RELATED', 'MF']);

const TESTAUTH_KNOWN = new Set(['FCTN', 'STATE', 'KEY', 'RBLEVEL', 'BRANCH']);
const TESTAUTH_STATES = new Set(['YES', 'NO']);

const RACROUTE_REQUESTS = new Set(['AUTH', 'FASTAUTH', 'DEFINE', 'DIRAUTH', 'EXTRACT', 'LIST', 'SIGNON', 'STAT', 'TOKENBLD', 'TOKENMAP', 'TOKENXTR', 'VERIFY', 'VERIFYX', 'AUDIT']);

function parseModeset(st, ops, opts) {
  const { keywords } = ops;
  const node = { kind: 'MODESET', key: null, mode: null, extkey: null, keywords: {} };

  for (const [k, v] of keywords) {
    if (!MODESET_KNOWN.has(k)) {
      throw new HlasmSyntax(`MODESET: unknown keyword ${k}`);
    }
    node.keywords[k] = v;
  }

  if (keywords.has('MF')) {
    const { form, list } = remoteForm(keywords.get('MF'), 'MF');
    const known = form === 'L' ? MODESET_LIST_KNOWN : MODESET_EXECUTE_KNOWN;
    for (const k of keywords.keys()) {
      if (!known.has(k)) throw new HlasmSyntax(`MODESET: the ${form === 'L' ? 'list' : 'execute'} form does not take ${k}`);
    }
    if (form === 'L' && !keywords.has('KEY') && !keywords.has('MODE')) throw new HlasmSyntax('MODESET: the list form needs KEY or MODE');
    node.mf = form;
    if (list) node.list = list;
  }

  if (keywords.has('EXTKEY')) {
    const v = keywords.get('EXTKEY').trim().toUpperCase();
    if (MVS38_EXTKEYS.has(v)) {
      mvs38Form(opts, node, 'MODESET', `EXTKEY=${v}`);
      node.pswKey = MVS38_EXTKEYS.get(v);
    } else if (!MODESET_EXTKEYS.has(v)) {
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
