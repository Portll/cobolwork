// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for HLASM listing instructions: PRINT, TITLE, EJECT, SPACE, CEJECT.

import { HlasmSyntax, splitOperands } from '../operands.mjs';
import { parseExpression } from '../expr.mjs';

const PRINT_OPTS = new Set(['ON', 'OFF', 'GEN', 'NOGEN', 'DATA', 'NODATA', 'MCALL', 'NOMCALL', 'MSOURCE', 'NOMSOURCE', 'UHEAD', 'NOUHEAD', 'NOPRINT']);

export const parsers = {
  PRINT(st) {
    const ops = splitOperands(st.field);
    if (ops.length === 0) throw new HlasmSyntax('PRINT requires at least one option');
    const options = ops.map(o => o.trim().toUpperCase());
    for (const opt of options) {
      if (!PRINT_OPTS.has(opt)) throw new HlasmSyntax(`unknown PRINT option: ${opt}`);
    }
    return { kind: 'PRINT', options };
  },
  TITLE(st) {
    const ops = splitOperands(st.field);
    if (ops.length !== 1) throw new HlasmSyntax('TITLE requires exactly one operand');
    const raw = ops[0].trim();
    if (!raw.startsWith("'") || !raw.endsWith("'") || raw.length < 2) throw new HlasmSyntax('TITLE operand must be a quoted string');
    const text = raw.slice(1, -1).replace(/''/g, "'").replace(/&&/g, "&");
    return { kind: 'TITLE', name: st.name, text };
  },
  EJECT(st) {
    if (st.field.trim() !== '') throw new HlasmSyntax('EJECT takes no operand');
    return { kind: 'EJECT', value: null };
  },
  SPACE(st) {
    const ops = splitOperands(st.field);
    if (ops.length === 0) return { kind: 'SPACE', value: null };
    if (ops.length > 1) throw new HlasmSyntax('SPACE takes at most one operand');
    return { kind: 'SPACE', value: parseExpression(ops[0].trim()) };
  },
  CEJECT(st) {
    const ops = splitOperands(st.field);
    if (ops.length === 0) return { kind: 'CEJECT', value: null };
    if (ops.length > 1) throw new HlasmSyntax('CEJECT takes at most one operand');
    return { kind: 'CEJECT', value: parseExpression(ops[0].trim()) };
  }
};
