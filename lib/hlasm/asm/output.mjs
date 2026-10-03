// SPDX-License-Identifier: AGPL-3.0-or-later
// Assembler instructions that write messages, copy source in or shape the input records: MNOTE,
// COPY, PUNCH, REPRO, AINSERT, ICTL and ISEQ.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=instructions-mnote-instruction
import { HlasmSyntax, NAME, splitOperands } from '../operands.mjs';
import { parseExpression } from '../expr.mjs';

// A quoted string's text, '' read as one quote and && as one ampersand.
function quoted(text, what) {
  const m = /^'((?:[^']|'')*)'$/.exec(text.trim());
  if (!m) throw new HlasmSyntax(`${what} needs a quoted string, not ${text}`);
  return m[1].replace(/''/g, "'").replace(/&&/g, '&');
}

const numbers = (st, min, max) => {
  const ops = splitOperands(st.field || '');
  if (ops.length < min || ops.length > max || ops.some((o) => !/^\d+$/.test(o.trim()))) throw new HlasmSyntax(`${st.operation} takes ${min} to ${max} decimal numbers, not ${st.field || 'none'}`);
  return { kind: st.operation, values: ops.map(Number) };
};

export const parsers = {
  // [severity,]'message': severity is an absolute expression, *, or empty before the comma.
  MNOTE: (st) => {
    const ops = splitOperands(st.field || '');
    if (ops.length < 1 || ops.length > 2) throw new HlasmSyntax(`MNOTE takes a message and an optional severity, not ${ops.length} operands`);
    const [sev, msg] = ops.length === 2 ? ops : [null, ops[0]];
    const severity = sev === null || sev.trim() === '' ? null : sev.trim() === '*' ? '*' : parseExpression(sev.trim());
    return { kind: 'MNOTE', severity, text: quoted(msg, 'MNOTE') };
  },
  COPY: (st) => {
    const member = (st.field || '').trim();
    if (!NAME.test(member)) throw new HlasmSyntax(`COPY names a member, not ${member || 'nothing'}`);
    return { kind: 'COPY', member: member.toUpperCase() };
  },
  PUNCH: (st) => ({ kind: 'PUNCH', text: quoted(st.field || '', 'PUNCH') }),
  REPRO: () => ({ kind: 'REPRO' }),
  // 'record'[,FRONT|BACK]: a record put into the assembler's input stream.
  AINSERT: (st) => {
    const ops = splitOperands(st.field || '');
    if (ops.length !== 2 || !/^(FRONT|BACK)$/i.test(ops[1].trim())) throw new HlasmSyntax('AINSERT takes a quoted record and FRONT or BACK');
    return { kind: 'AINSERT', text: quoted(ops[0], 'AINSERT'), where: ops[1].trim().toUpperCase() };
  },
  ICTL: (st) => numbers(st, 1, 3),
  ISEQ: (st) => (st.field ? numbers(st, 2, 2) : { kind: 'ISEQ', values: [] }),
};
