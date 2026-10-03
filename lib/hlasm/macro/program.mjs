// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for z/OS program-management macros: LINK, XCTL, LOAD, ATTACH.
import { HlasmSyntax, NAME } from '../operands.mjs';

const ADDR = /^(?:\(\d{1,2}\)|[A-Z$#@_][A-Z0-9$#@_]*|[\w$#@_]+(?:\s*[-+*/]\s*[\w$#@_]+)*)$/i;
const NUM_OR_ADDR = /^(?:\d+|\(\d{1,2}\)|[A-Z$#@_][A-Z0-9$#@_]*|[\w$#@_]+(?:\s*[-+*/]\s*[\w$#@_]+)*)$/i;
const YES_NO = /^(?:YES|NO)$/i;

function parseLink(st, ops) {
  const kw = ops.keywords;
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'PARAM', 'VL', 'ID', 'ERRET', 'LSEARCH']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  if (ops.positional.length > 0) throw new HlasmSyntax('unexpected positional operand');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !ADDR.test(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !ADDR.test(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !ADDR.test(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('ERRET') && !ADDR.test(kw.get('ERRET').trim())) throw new HlasmSyntax('invalid ERRET address');
  if (kw.has('LSEARCH') && !YES_NO.test(kw.get('LSEARCH').trim())) throw new HlasmSyntax('invalid LSEARCH value');
  if (kw.has('VL') && !/^\d+$/.test(kw.get('VL').trim())) throw new HlasmSyntax('invalid VL value');
  if (kw.has('ID') && !/^\d+$/.test(kw.get('ID').trim())) throw new HlasmSyntax('invalid ID value');
  let param = null;
  if (kw.has('PARAM')) {
    const p = kw.get('PARAM').trim();
    if (p.startsWith('(') && p.endsWith(')')) {
      const inner = p.slice(1, -1).trim();
      if (inner !== '') {
        const parts = inner.split(',').map(s => s.trim());
        for (const part of parts) {
          if (!ADDR.test(part)) throw new HlasmSyntax('invalid PARAM address');
        }
      }
    } else if (!ADDR.test(p)) {
      throw new HlasmSyntax('invalid PARAM address');
    }
    param = p;
  }
  return { kind: 'LINK', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, param, keywords: Object.fromEntries(kw) };
}

function parseXctl(st, ops) {
  const kw = ops.keywords;
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'LSEARCH']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  // The registers to restore before control passes: (reg) or (reg1,reg2), numbers or EQU symbols.
  if (ops.positional.length > 1) throw new HlasmSyntax('too many positional operands');
  if (ops.positional.length === 1 && ops.positional[0].trim() !== '' && !/^\(\s*[A-Z0-9$#@_]+\s*(,\s*[A-Z0-9$#@_]+\s*)?\)$/i.test(ops.positional[0].trim())) throw new HlasmSyntax('invalid register list');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !ADDR.test(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !ADDR.test(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !ADDR.test(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('LSEARCH') && !YES_NO.test(kw.get('LSEARCH').trim())) throw new HlasmSyntax('invalid LSEARCH value');
  return { kind: 'XCTL', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, keywords: Object.fromEntries(kw) };
}

function parseLoad(st, ops) {
  const kw = ops.keywords;
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'ERRET', 'LSEARCH', 'LOADPT', 'LOADPT64', 'EXTINFO', 'RELATED']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  if (ops.positional.length > 0) throw new HlasmSyntax('unexpected positional operand');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !ADDR.test(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !ADDR.test(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !ADDR.test(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('ERRET') && !ADDR.test(kw.get('ERRET').trim())) throw new HlasmSyntax('invalid ERRET address');
  if (kw.has('LSEARCH') && !YES_NO.test(kw.get('LSEARCH').trim())) throw new HlasmSyntax('invalid LSEARCH value');
  if (kw.has('LOADPT') && !ADDR.test(kw.get('LOADPT').trim())) throw new HlasmSyntax('invalid LOADPT address');
  if (kw.has('LOADPT64') && !ADDR.test(kw.get('LOADPT64').trim())) throw new HlasmSyntax('invalid LOADPT64 address');
  if (kw.has('EXTINFO') && !ADDR.test(kw.get('EXTINFO').trim())) throw new HlasmSyntax('invalid EXTINFO address');
  return { kind: 'LOAD', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, keywords: Object.fromEntries(kw) };
}

function parseAttach(st, ops) {
  const kw = ops.keywords;
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'LPMOD', 'DPMOD', 'PARAM', 'VL', 'ECB', 'ETXR', 'GSPV', 'GSPL', 'SHSPV', 'SHSPL', 'SZERO', 'TASKLIB', 'STAI', 'ESTAI', 'PURGE', 'ASYNCH', 'TERM', 'ALCOPY', 'RELATED']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  if (ops.positional.length > 0) throw new HlasmSyntax('unexpected positional operand');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !ADDR.test(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !ADDR.test(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !ADDR.test(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('LPMOD') && !NUM_OR_ADDR.test(kw.get('LPMOD').trim())) throw new HlasmSyntax('invalid LPMOD value');
  if (kw.has('DPMOD') && !NUM_OR_ADDR.test(kw.get('DPMOD').trim())) throw new HlasmSyntax('invalid DPMOD value');
  if (kw.has('VL') && !/^\d+$/.test(kw.get('VL').trim())) throw new HlasmSyntax('invalid VL value');
  if (kw.has('ECB') && !ADDR.test(kw.get('ECB').trim())) throw new HlasmSyntax('invalid ECB address');
  if (kw.has('ETXR') && !ADDR.test(kw.get('ETXR').trim())) throw new HlasmSyntax('invalid ETXR address');
  if (kw.has('GSPV') && !NUM_OR_ADDR.test(kw.get('GSPV').trim())) throw new HlasmSyntax('invalid GSPV value');
  if (kw.has('GSPL') && !ADDR.test(kw.get('GSPL').trim())) throw new HlasmSyntax('invalid GSPL address');
  if (kw.has('SHSPV') && !NUM_OR_ADDR.test(kw.get('SHSPV').trim())) throw new HlasmSyntax('invalid SHSPV value');
  if (kw.has('SHSPL') && !ADDR.test(kw.get('SHSPL').trim())) throw new HlasmSyntax('invalid SHSPL address');
  if (kw.has('SZERO') && !YES_NO.test(kw.get('SZERO').trim())) throw new HlasmSyntax('invalid SZERO value');
  if (kw.has('TASKLIB') && !ADDR.test(kw.get('TASKLIB').trim())) throw new HlasmSyntax('invalid TASKLIB address');
  if (kw.has('STAI') && !ADDR.test(kw.get('STAI').trim())) throw new HlasmSyntax('invalid STAI address');
  if (kw.has('ESTAI') && !ADDR.test(kw.get('ESTAI').trim())) throw new HlasmSyntax('invalid ESTAI address');
  if (kw.has('PURGE') && !/^(?:QUIESCE|NONE|HALT)$/i.test(kw.get('PURGE').trim())) throw new HlasmSyntax('invalid PURGE value');
  if (kw.has('ASYNCH') && !YES_NO.test(kw.get('ASYNCH').trim())) throw new HlasmSyntax('invalid ASYNCH value');
  if (kw.has('TERM') && !YES_NO.test(kw.get('TERM').trim())) throw new HlasmSyntax('invalid TERM value');
  if (kw.has('ALCOPY') && !YES_NO.test(kw.get('ALCOPY').trim())) throw new HlasmSyntax('invalid ALCOPY value');
  let param = null;
  if (kw.has('PARAM')) {
    const p = kw.get('PARAM').trim();
    if (p.startsWith('(') && p.endsWith(')')) {
      const inner = p.slice(1, -1).trim();
      if (inner !== '') {
        const parts = inner.split(',').map(s => s.trim());
        for (const part of parts) {
          if (!ADDR.test(part)) throw new HlasmSyntax('invalid PARAM address');
        }
      }
    } else if (!ADDR.test(p)) {
      throw new HlasmSyntax('invalid PARAM address');
    }
    param = p;
  }
  return { kind: 'ATTACH', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, param, keywords: Object.fromEntries(kw) };
}

export const parsers = Object.freeze({ LINK: parseLink, XCTL: parseXctl, LOAD: parseLoad, ATTACH: parseAttach });
