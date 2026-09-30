// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a source line's fields sit on the card. COBOL in fixed or variable reference format has a
// sequence area (columns 1-6), an indicator (7), program text (8-72, or 8-250 in variable format) and
// what follows, which the compiler ignores. A JCL or utility control statement is columns 1-72, with
// its sequence number after. Free-format COBOL is text from end to end.

export const TEXT_END = { fixed: 72, variable: 250 };
export const STATEMENT_END = 72;

export function cobolCard(line, format) {
  const end = TEXT_END[format];
  if (!end) return { sequence: '', indicator: '', text: line, ignored: '' };
  return { sequence: line.slice(0, 6), indicator: line[6] || ' ', text: line.slice(7, end), ignored: line.slice(end) };
}

export function statementCard(line) {
  return { text: line.slice(0, STATEMENT_END), sequence: line.slice(STATEMENT_END) };
}
