// SPDX-License-Identifier: AGPL-3.0-or-later
// Parsers for ON, SIGNAL, REVERT and RESIGNAL statements.

const CONDITION_NAMES = new Set([
  'ENDFILE', 'ENDPAGE', 'KEY', 'RECORD', 'TRANSMIT', 'UNDEFINEDFILE', 'UNDF',
  'NAME', 'CONDITION', 'COND',
  'ERROR', 'FINISH', 'CONVERSION', 'CONV', 'FIXEDOVERFLOW', 'FOFL',
  'OVERFLOW', 'OFL', 'UNDERFLOW', 'UFL', 'ZERODIVIDE', 'ZDIV',
  'SIZE', 'STRINGRANGE', 'STRG', 'STRINGSIZE', 'STRZ',
  'SUBSCRIPTRANGE', 'SUBRG', 'AREA', 'STORAGE', 'ATTENTION', 'ATTN',
  'INVALIDOP', 'ANYCONDITION', 'ANYCOND'
]);

function parseCondition(c) {
  const nameTok = c.next();
  if (!nameTok || nameTok.t !== 'word' || !CONDITION_NAMES.has(nameTok.u)) {
    c.fail('a condition name');
  }
  const name = nameTok.u;
  let arg = null;
  if (c.isOp('(')) {
    const inner = c.group();
    arg = inner;
  }
  return { name, arg };
}

function parseConditions(c) {
  const conditions = [];
  const first = parseCondition(c);
  conditions.push(first);

  while (c.isOp(',')) {
    c.next();
    const next = parseCondition(c);
    conditions.push(next);
  }

  return conditions;
}

function parseOn(c, stmt, ctx) {
  c.expectWord('ON');

  const conditions = parseConditions(c);

  let snap = false;
  if (c.isWord('SNAP')) {
    c.next();
    snap = true;
  }

  let system = false;
  if (c.isWord('SYSTEM')) {
    c.next();
    system = true;
  }

  const units = [];
  if (!system) {
    const rest = c.drain();
    if (rest.length > 0) {
      const sub = ctx.subStatement(stmt, rest);
      const result = ctx.parseStatement(sub);
      units.push(result);
    }
  }

  return { kind: 'ON', conditions, snap, system, units };
}

function parseSignal(c, stmt, ctx) {
  c.expectWord('SIGNAL');
  const condition = parseCondition(c);
  return { kind: 'SIGNAL', condition, units: [] };
}

function parseRevert(c, stmt, ctx) {
  c.expectWord('REVERT');
  const condition = parseCondition(c);
  return { kind: 'REVERT', condition, units: [] };
}

function parseResignal(c, stmt, ctx) {
  c.expectWord('RESIGNAL');
  return { kind: 'RESIGNAL', units: [] };
}

export const parsers = {
  ON: parseOn,
  SIGNAL: parseSignal,
  REVERT: parseRevert,
  RESIGNAL: parseResignal
};
