// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for z/OS program-management macros: LINK, XCTL, LOAD, ATTACH.
import { HlasmSyntax, NAME, remoteForm, splitOperands } from '../operands.mjs';
import { parseAddress } from '../expr.mjs';
import { MVS38_HIARCHY, MVS38_KEYWORDS, mvs38Form } from '../mvs38.mjs';

// An RX-type or A-type address, a register in parentheses, a literal or an absolute expression, as
// the macros' operands are written: anything the address reader takes.
const isAddress = (text) => {
  const t = String(text).trim();
  if (t === '') return false;
  try { parseAddress(t); return true; } catch { return false; }
};
const YES_NO = /^(?:YES|NO)$/i;

// STAI= and ESTAI= of ATTACH: an exit address, or (exit addr,parm addr).
const isExit = (text) => {
  const t = String(text).trim();
  if (isAddress(t)) return true;
  if (!t.startsWith('(') || !t.endsWith(')')) return false;
  const parts = splitOperands(t.slice(1, -1));
  return parts.length <= 2 && parts.every(isAddress);
};

// The list form (SF=L) and the execute form (MF=(E,addr), SF=(E,addr)) of LINK and XCTL (z/OS 3.1
// MVS Programming: Assembler Services Reference, Volume 2). The list form may leave the entry point
// to the execute form, and an execute form with SF=(E,addr) may take it from the list.
function forms(kw, macro) {
  const sf = kw.has('SF') ? remoteForm(kw.get('SF'), 'SF') : null;
  const mf = kw.has('MF') ? remoteForm(kw.get('MF'), 'MF') : null;
  if (mf && mf.form !== 'E') throw new HlasmSyntax(`${macro} takes MF only as (E,addr)`);
  if (sf && sf.form === 'L' && (mf || kw.has('PARAM'))) throw new HlasmSyntax(`the list form of ${macro} takes no MF or PARAM`);
  const out = {};
  if (sf) out.sf = sf.form === 'L' ? 'L' : { form: 'E', list: sf.list };
  if (mf) out.mf = { form: 'E', list: mf.list };
  return { out, entryOptional: Boolean(sf) };
}

// PARAM=(addr,addr,...): an execute form may leave an entry empty, to keep the list form's.
// A list form (SF=L) may write a keyword with no value, reserving its field for the execute form.
function written(keywords) {
  if (!/^L$/i.test(String(keywords.get('SF') || '').trim())) return keywords;
  return new Map([...keywords].filter(([, v]) => String(v).trim() !== ''));
}

function parseParam(raw, execute = false) {
  const p = raw.trim();
  if (p.startsWith('(') && p.endsWith(')')) {
    const inner = p.slice(1, -1).trim();
    if (inner !== '') {
      for (const part of splitOperands(inner).map(s => s.trim())) {
        if (part === '' ? !execute : !isAddress(part)) throw new HlasmSyntax('invalid PARAM address');
      }
    }
  } else if (!isAddress(p)) {
    throw new HlasmSyntax('invalid PARAM address');
  }
  return p;
}

function parseLink(st, ops) {
  const kw = written(ops.keywords);
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'PARAM', 'VL', 'ID', 'ERRET', 'LSEARCH', 'SF', 'MF']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  if (ops.positional.some((p) => p.trim() !== '')) throw new HlasmSyntax('unexpected positional operand');
  const { out: form, entryOptional } = forms(kw, 'LINK');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0 && !entryOptional) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !isAddress(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !isAddress(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !isAddress(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('ERRET') && !isAddress(kw.get('ERRET').trim())) throw new HlasmSyntax('invalid ERRET address');
  if (kw.has('LSEARCH') && !YES_NO.test(kw.get('LSEARCH').trim())) throw new HlasmSyntax('invalid LSEARCH value');
  if (kw.has('VL') && !/^\d+$/.test(kw.get('VL').trim())) throw new HlasmSyntax('invalid VL value');
  if (kw.has('ID') && !/^\d+$/.test(kw.get('ID').trim())) throw new HlasmSyntax('invalid ID value');
  const param = kw.has('PARAM') ? parseParam(kw.get('PARAM'), Boolean(form.mf)) : null;
  return { kind: 'LINK', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, param, ...form, keywords: Object.fromEntries(kw) };
}

function parseXctl(st, ops) {
  const kw = written(ops.keywords);
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'LSEARCH', 'SF', 'MF', 'PARAM', 'VL']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  const { out: form, entryOptional } = forms(kw, 'XCTL');
  // XCTL builds a parameter list only in its execute form, at MF=(E,addr).
  if ((kw.has('PARAM') || kw.has('VL')) && !form.mf) throw new HlasmSyntax('XCTL takes PARAM and VL only with MF=(E,addr)');
  if (kw.has('VL') && !/^\d+$/.test(kw.get('VL').trim())) throw new HlasmSyntax('invalid VL value');
  // The registers to restore before control passes: (reg) or (reg1,reg2), numbers or EQU symbols.
  if (ops.positional.length > 1) throw new HlasmSyntax('too many positional operands');
  if (ops.positional.length === 1 && ops.positional[0].trim() !== '' && !/^\(\s*[A-Z0-9$#@_]+\s*(,\s*[A-Z0-9$#@_]+\s*)?\)$/i.test(ops.positional[0].trim())) throw new HlasmSyntax('invalid register list');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0 && !entryOptional) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !isAddress(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !isAddress(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !isAddress(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('LSEARCH') && !YES_NO.test(kw.get('LSEARCH').trim())) throw new HlasmSyntax('invalid LSEARCH value');
  const param = kw.has('PARAM') ? parseParam(kw.get('PARAM'), true) : null;
  return { kind: 'XCTL', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, ...(param ? { param } : {}), ...form, keywords: Object.fromEntries(kw) };
}

function parseLoad(st, ops) {
  const kw = written(ops.keywords);
  // The standard, list and execute forms, authorized keywords included (z/OS 3.1 MVS Programming:
  // Authorized Assembler Services Reference, Volume 3, LOAD).
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'ERRET', 'LSEARCH', 'LOADPT', 'LOADPT64', 'EXTINFO', 'RELATED',
    'ADDR', 'ADDR64', 'ADRNAPF', 'ADRNAPF64', 'ARCHLVL', 'EOM', 'FETCHOPT', 'GLOBAL', 'PLISTVER', 'RMODE', 'SF']);
  for (const k of kw.keys()) if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  if (ops.positional.some((p) => p.trim() !== '')) throw new HlasmSyntax('unexpected positional operand');
  const { out: form, entryOptional } = forms(kw, 'LOAD');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0 && !entryOptional) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !isAddress(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !isAddress(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !isAddress(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('ERRET') && !isAddress(kw.get('ERRET').trim())) throw new HlasmSyntax('invalid ERRET address');
  if (kw.has('LSEARCH') && !YES_NO.test(kw.get('LSEARCH').trim())) throw new HlasmSyntax('invalid LSEARCH value');
  if (kw.has('LOADPT') && !isAddress(kw.get('LOADPT').trim())) throw new HlasmSyntax('invalid LOADPT address');
  if (kw.has('LOADPT64') && !isAddress(kw.get('LOADPT64').trim())) throw new HlasmSyntax('invalid LOADPT64 address');
  if (kw.has('EXTINFO') && !isAddress(kw.get('EXTINFO').trim())) throw new HlasmSyntax('invalid EXTINFO address');
  return { kind: 'LOAD', ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, ...form, keywords: Object.fromEntries(kw) };
}

function parseAttach(st, ops, opts) {
  const kw = written(ops.keywords);
  // The standard, list and execute forms, authorized keywords included (z/OS 3.1 MVS Programming:
  // Authorized Assembler Services Reference, Volume 1, ATTACH and ATTACHX).
  const allowed = new Set(['EP', 'EPLOC', 'DE', 'DCB', 'LPMOD', 'DPMOD', 'PARAM', 'VL', 'ECB', 'ETXR', 'GSPV', 'GSPL', 'SHSPV', 'SHSPL', 'SZERO', 'TASKLIB', 'STAI', 'ESTAI', 'PURGE', 'ASYNCH', 'TERM', 'ALCOPY', 'RELATED',
    'ADDRENV', 'ASCENV', 'BYADDRESS', 'DISP', 'JSTCB', 'KEY', 'MF', 'NSHSPL', 'NSHSPV', 'PKM', 'PLIST4', 'PLIST8', 'PLIST8ARALETS', 'PLISTARALETS', 'RSAPF', 'SDWALOC31', 'SF', 'SM', 'SVAREA', 'TCB', 'TID']);
  const legacy = {};
  for (const k of kw.keys()) {
    if (MVS38_KEYWORDS.ATTACH.has(k)) mvs38Form(opts, legacy, 'ATTACH', `${k}=${kw.get(k).trim()}`);
    else if (!allowed.has(k)) throw new HlasmSyntax(`unknown keyword ${k}`);
  }
  if (kw.has('HIARCHY') && !MVS38_HIARCHY.test(kw.get('HIARCHY').trim())) throw new HlasmSyntax('invalid HIARCHY value');
  if (kw.has('JSCB') && !isAddress(kw.get('JSCB').trim())) throw new HlasmSyntax('invalid JSCB address');
  if (ops.positional.some((p) => p.trim() !== '')) throw new HlasmSyntax('unexpected positional operand');
  const { out: form, entryOptional } = forms(kw, 'ATTACH');
  const epKeys = ['EP', 'EPLOC', 'DE'].filter(k => kw.has(k));
  if (epKeys.length > 1) throw new HlasmSyntax('EP, EPLOC, and DE are mutually exclusive');
  if (epKeys.length === 0 && !entryOptional) throw new HlasmSyntax('missing EP, EPLOC, or DE');
  const ep = kw.has('EP') ? kw.get('EP').trim().toUpperCase() : null;
  const eploc = kw.has('EPLOC') ? kw.get('EPLOC') : null;
  const de = kw.has('DE') ? kw.get('DE') : null;
  if (ep && !NAME.test(ep)) throw new HlasmSyntax('invalid EP name');
  if (eploc && !isAddress(eploc.trim())) throw new HlasmSyntax('invalid EPLOC address');
  if (de && !isAddress(de.trim())) throw new HlasmSyntax('invalid DE address');
  if (kw.has('DCB') && !isAddress(kw.get('DCB').trim())) throw new HlasmSyntax('invalid DCB address');
  if (kw.has('LPMOD') && !isAddress(kw.get('LPMOD').trim())) throw new HlasmSyntax('invalid LPMOD value');
  if (kw.has('DPMOD') && !isAddress(kw.get('DPMOD').trim())) throw new HlasmSyntax('invalid DPMOD value');
  if (kw.has('VL') && !/^\d+$/.test(kw.get('VL').trim())) throw new HlasmSyntax('invalid VL value');
  if (kw.has('ECB') && !isAddress(kw.get('ECB').trim())) throw new HlasmSyntax('invalid ECB address');
  if (kw.has('ETXR') && !isAddress(kw.get('ETXR').trim())) throw new HlasmSyntax('invalid ETXR address');
  if (kw.has('GSPV') && !isAddress(kw.get('GSPV').trim())) throw new HlasmSyntax('invalid GSPV value');
  if (kw.has('GSPL') && !isAddress(kw.get('GSPL').trim())) throw new HlasmSyntax('invalid GSPL address');
  if (kw.has('SHSPV') && !isAddress(kw.get('SHSPV').trim())) throw new HlasmSyntax('invalid SHSPV value');
  if (kw.has('SHSPL') && !isAddress(kw.get('SHSPL').trim())) throw new HlasmSyntax('invalid SHSPL address');
  if (kw.has('SZERO') && !YES_NO.test(kw.get('SZERO').trim())) throw new HlasmSyntax('invalid SZERO value');
  if (kw.has('TASKLIB') && !isAddress(kw.get('TASKLIB').trim())) throw new HlasmSyntax('invalid TASKLIB address');
  if (kw.has('STAI') && !isExit(kw.get('STAI'))) throw new HlasmSyntax('invalid STAI address');
  if (kw.has('ESTAI') && !isExit(kw.get('ESTAI'))) throw new HlasmSyntax('invalid ESTAI address');
  if (kw.has('PURGE') && !/^(?:QUIESCE|NONE|HALT)$/i.test(kw.get('PURGE').trim())) throw new HlasmSyntax('invalid PURGE value');
  if (kw.has('ASYNCH') && !YES_NO.test(kw.get('ASYNCH').trim())) throw new HlasmSyntax('invalid ASYNCH value');
  if (kw.has('TERM') && !YES_NO.test(kw.get('TERM').trim())) throw new HlasmSyntax('invalid TERM value');
  if (kw.has('ALCOPY') && !YES_NO.test(kw.get('ALCOPY').trim())) throw new HlasmSyntax('invalid ALCOPY value');
  const param = kw.has('PARAM') ? parseParam(kw.get('PARAM'), Boolean(form.mf)) : null;
  return { kind: 'ATTACH', ...legacy, ep, eploc, de, dcb: kw.has('DCB') ? kw.get('DCB') : null, param, ...form, keywords: Object.fromEntries(kw) };
}

export const parsers = Object.freeze({ LINK: parseLink, XCTL: parseXctl, LOAD: parseLoad, ATTACH: parseAttach });
