// SPDX-License-Identifier: AGPL-3.0-or-later
// The PL/I rules: each module checks one parsed program and returns findings. A program is
// { path, statements } where each statement is as readPli gives it with `parsed`, its parseStatement
// result, attached.
import { readPli } from '../lex.mjs';
import { parseStatement } from '../statements.mjs';
import * as based from './based.mjs';
import * as entry from './entry.mjs';
import * as preprocessor from './preprocessor.mjs';
import * as conditions from './conditions.mjs';

const MODULES = [based, entry, preprocessor, conditions];

export const PLI_RULES = Object.freeze(Object.assign({}, ...MODULES.map((m) => m.RULES)));

export function programOf(path, text) {
  const statements = readPli(text, { file: path }).statements.map((st) => ({ ...st, parsed: parseStatement(st) }));
  return { path, statements };
}

// Findings { rule, path, line, detail } for one program, in source order.
export function checkProgram(program) {
  return MODULES.flatMap((m) => m.check(program)).sort((a, b) => a.line - b.line || (a.rule < b.rule ? -1 : 1));
}
