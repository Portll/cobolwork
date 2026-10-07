// SPDX-License-Identifier: AGPL-3.0-or-later
// Parser for z/OS data-set macros: OPEN, CLOSE, and DCB.
import { HlasmSyntax, NAME, remoteForm, splitOperands } from '../operands.mjs';
import { parseAddress } from '../expr.mjs';

const OPEN_OPTS = new Set(['INPUT', 'OUTPUT', 'UPDAT', 'EXTEND', 'OUTIN', 'OUTINX', 'INOUT', 'RDBACK', 'DISP', 'LEAVE', 'REREAD']);
const CLOSE_OPTS = new Set(['REREAD', 'LEAVE', 'REWIND', 'FREE', 'DISP']);
const DCB_KEYWORDS = new Set(['BFALN', 'BFTEK', 'BLKSIZE', 'BUFCB', 'BUFL', 'BUFNO', 'BUFOFF', 'DCBE', 'DDNAME', 'DEVD', 'DSORG', 'EODAD', 'EROPT', 'EXLST', 'LRECL', 'MACRF', 'NCP', 'OPTCD', 'RECFM', 'SYNAD', 'KEYLEN', 'LIMCT', 'RKP', 'DEN', 'TRTCH', 'PRTSP', 'STACK', 'FUNC', 'MODE', 'CODE',
  // EXCP (z/OS 3.1 DFSMSdfp Advanced Services, Data Control Block (DCB) Fields).
  'REPOS', 'EOEA', 'PCIA', 'SIOA', 'CENDA', 'XENDA', 'IMSK', 'PGFIX', 'IOBAD']);

// (dcb,(options),dcb,(options),...): each DCB address followed by its options, written in parentheses,
// as one bare word or omitted. A single DCB may be written without the outer parentheses. The list
// form (MF=L) and the execute form (MF=(E,addr)) may leave a DCB address empty, to be filled in by
// the other (z/OS 3.1 DFSMS Macro Instructions for Data Sets, OPEN and CLOSE list and execute forms).
function parseDcbList(raw, validOpts, emptyAllowed = false) {
  const text = raw.trim();
  const items = text.startsWith('(') && text.endsWith(')') ? splitOperands(text.slice(1, -1)) : [text];
  const dcbs = [];
  for (let i = 0; i < items.length; i++) {
    const dcbRaw = items[i].trim();
    if (!dcbRaw && !emptyAllowed) throw new HlasmSyntax('empty dcb address in list');
    let dcb = null;
    if (dcbRaw) try { dcb = parseAddress(dcbRaw); } catch { throw new HlasmSyntax(`invalid dcb address: ${dcbRaw}`); }
    const next = (items[i + 1] ?? '').trim();
    const word = next.toUpperCase();
    let options = [];
    if (next.startsWith('(') && next.endsWith(')')) options = splitOperands(next.slice(1, -1)).map((o) => o.trim().toUpperCase()).filter(Boolean);
    else if (validOpts.has(word)) options = [word];
    else if (next !== '' || i + 1 >= items.length) { dcbs.push({ dcb, options }); continue; }
    for (const o of options) if (!validOpts.has(o)) throw new HlasmSyntax(`unknown option: ${o}`);
    dcbs.push({ dcb, options });
    i++;
  }
  return dcbs;
}

// The DCB list of OPEN or CLOSE and the form MF= gives it; the execute form may omit the list.
function dcbOperand(macro, ops, validOpts) {
  const mf = ops.keywords.has('MF') ? remoteForm(ops.keywords.get('MF'), 'MF') : null;
  if (ops.positional.length === 0 && mf?.form === 'E') return { dcbs: [], mf };
  if (ops.positional.length !== 1) throw new HlasmSyntax(`${macro} requires exactly one positional operand`);
  return { dcbs: parseDcbList(ops.positional[0], validOpts, Boolean(mf)), mf };
}

export const parsers = {
  OPEN(st, ops) {
    const { dcbs, mf } = dcbOperand('OPEN', ops, OPEN_OPTS);
    const keywords = {};
    for (const [k, v] of ops.keywords) {
      if (k === 'TYPE') {
        if (v.toUpperCase() !== 'J') throw new HlasmSyntax('OPEN TYPE must be J');
        keywords.TYPE = v;
      } else if (k === 'MODE') {
        if (v !== '24' && v !== '31') throw new HlasmSyntax('OPEN MODE must be 24 or 31');
        keywords.MODE = v;
      } else if (k === 'MF') {
        keywords.MF = v;
      } else {
        throw new HlasmSyntax(`unknown keyword for OPEN: ${k}`);
      }
    }
    return { kind: 'OPEN', dcbs, ...(mf ? { mf: mf.form === 'L' ? 'L' : { form: 'E', list: mf.list } } : {}), keywords };
  },
  CLOSE(st, ops) {
    const { dcbs, mf } = dcbOperand('CLOSE', ops, CLOSE_OPTS);
    const keywords = {};
    for (const [k, v] of ops.keywords) {
      if (k === 'TYPE') {
        if (v.toUpperCase() !== 'T') throw new HlasmSyntax('CLOSE TYPE must be T');
        keywords.TYPE = v;
      } else if (k === 'MODE') {
        if (v !== '24' && v !== '31') throw new HlasmSyntax('CLOSE MODE must be 24 or 31');
        keywords.MODE = v;
      } else if (k === 'MF') {
        keywords.MF = v;
      } else {
        throw new HlasmSyntax(`unknown keyword for CLOSE: ${k}`);
      }
    }
    return { kind: 'CLOSE', dcbs, ...(mf ? { mf: mf.form === 'L' ? 'L' : { form: 'E', list: mf.list } } : {}), keywords };
  },
  DCB(st, ops) {
    if (ops.positional.length > 0) throw new HlasmSyntax('DCB takes no positional operands');
    const keywords = {};
    let ddname = null;
    let dsorg = null;
    let macrf = null;
    let recfm = null;
    let lrecl = null;
    let blksize = null;
    for (const [k, v] of ops.keywords) {
      if (!DCB_KEYWORDS.has(k)) throw new HlasmSyntax(`unknown keyword for DCB: ${k}`);
      keywords[k] = v;
      if (k === 'DDNAME') ddname = v.toUpperCase();
      else if (k === 'DSORG') dsorg = v;
      else if (k === 'MACRF') macrf = v;
      else if (k === 'RECFM') recfm = v;
      else if (k === 'LRECL') lrecl = v;
      else if (k === 'BLKSIZE') blksize = v;
    }
    return { kind: 'DCB', name: st.name, ddname, dsorg, macrf, recfm, lrecl, blksize, keywords };
  }
};
