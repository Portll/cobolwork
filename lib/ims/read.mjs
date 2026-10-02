// SPDX-License-Identifier: AGPL-3.0-or-later
// IMS DBD and PSB source, read as the assembler reads its macro cards (lib/bms.mjs folds them), and
// each statement parsed by its macro's parser: DBD, DATASET, SEGM, FIELD, LCHILD, XDFLD and DBDGEN
// for a database, PCB, SENSEG, SENFLD and PSBGEN for a program's view of it.
import { foldStatements } from '../bms.mjs';
import { parseOperands } from '../cards.mjs';
import { ImsSyntax } from './operands.mjs';
import { parsers as dbd } from './macro/dbd.mjs';
import { parsers as psb } from './macro/psb.mjs';

export const PARSERS = Object.freeze({ ...dbd, ...psb });

// Assembler instructions around the macros, which carry nothing for IMS.
const ASSEMBLER = new Set(['TITLE', 'PRINT', 'EJECT', 'SPACE', 'END', 'FINISH', 'ICTL', 'ISEQ', 'PUNCH']);
export const IMS_MACROS = new Set(['DBD', 'DATASET', 'AREA', 'SEGM', 'FIELD', 'LCHILD', 'XDFLD', 'DBDGEN', 'PCB', 'SENSEG', 'SENFLD', 'PSBGEN']);

export function readIms(text) {
  const { statements, diags } = foldStatements(text);
  return { statements: statements.filter((s) => s.kind !== 'comment'), diags };
}

// { kind, status, node?, reason? } as the PL/I reader gives them: parsed, unbuilt (no parser for the
// macro yet), unparsed (the parser refused an operand) or unknown (not an IMS macro).
export function parseImsStatement(st) {
  if (st.kind !== 'statement') return { kind: 'UNREADABLE', status: 'unknown', reason: 'no operation field' };
  const kind = st.operation;
  if (ASSEMBLER.has(kind)) return { kind: 'ASSEMBLER', status: 'parsed', node: { kind, operation: kind } };
  if (!IMS_MACROS.has(kind)) return { kind: 'UNKNOWN', status: 'unknown', reason: `${kind} is not an IMS DBD or PSB macro` };
  const parser = PARSERS[kind];
  if (!parser) return { kind, status: 'unbuilt' };
  try {
    return { kind, status: 'parsed', node: parser(st, parseOperands(st.field)) };
  } catch (e) {
    if (e instanceof ImsSyntax) return { kind, status: 'unparsed', reason: e.message };
    return { kind, status: 'unparsed', reason: `parser error: ${e && e.message}`, crash: true };
  }
}
