// SPDX-License-Identifier: AGPL-3.0-or-later
// Card-image source: where a line's fields sit on the card, and how an operand field splits. COBOL
// in fixed or variable reference format has a sequence area (columns 1-6), an indicator (7), program
// text (8-72, or 8-250 in variable format) and what follows, which the compiler ignores. A JCL or
// utility control statement is columns 1-72, with its sequence number after. Free-format COBOL is
// text from end to end.

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

// Splits an operand field on commas that are not inside parentheses or quotes. JCL, BMS and HLASM nest
// both, and a naive split on comma turns DISP=(NEW,CATLG,DELETE) into three operands.
export function splitOperands(s) {
  const out = [];
  let depth = 0, quoted = false, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) { if (c === "'") { if (s[i + 1] === "'") i++; else quoted = false; } continue; }
    if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === ',' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out.filter((x, i, a) => x.length || i < a.length - 1);
}

// Operands are positional until the first KEY=VALUE, and keyword after it: JCL's EXEC takes its
// procedure name positionally, and everything interesting on a DD is a keyword.
export function parseOperands(field) {
  const positional = [];
  const keywords = new Map();
  for (const raw of splitOperands(field)) {
    const part = raw.trim();
    if (!part) continue;
    const eq = keywordSplit(part);
    if (eq < 0) positional.push(part);
    else keywords.set(part.slice(0, eq).toUpperCase(), part.slice(eq + 1));
  }
  return { positional, keywords };
}

// The first '=' that is not inside parentheses or quotes. DCB=(RECFM=FB,LRECL=80) is one keyword
// whose value happens to contain more of them.
function keywordSplit(part) {
  let depth = 0, quoted = false;
  for (let i = 0; i < part.length; i++) {
    const c = part[i];
    if (quoted) { if (c === "'") { if (part[i + 1] === "'") i++; else quoted = false; } continue; }
    if (c === "'") quoted = true;
    else if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (c === '=' && depth === 0) return i;
  }
  return -1;
}
