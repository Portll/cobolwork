import { test } from 'node:test';
import assert from 'node:assert/strict';
import { locate } from '../lib/hlasm/locate.mjs';
import './pin-machine.mjs';

// Expected locations and lengths are z390 1.8.4.4's listing of these programs, relative to each
// section; EQU lengths follow HLASM's leftmost-term rule, where z390 gives 1.
const PROGRAM = [
  'FIRST    CSECT',
  "         LA    1,=F'1'",
  "         MVC   A(2),=C'XY'",
  "A        DC    C'ABC'",
  'B        DS    H',
  "C        DC    PL3'12',Z'123',X'1,2,3'",
  'D        DS    0D',
  "E        DC    2F'1,2'",
  'F        EQU   *-E',
  'G        EQU   A,5',
  'H        EQU   B+2',
  '         CNOP  2,8',
  'I        DS    CL3',
  '         LTORG',
  'J        DC    A(A)',
  '         ORG   A+1',
  'K        DS    C',
  '         ORG',
  'L        DS    X',
  'SECOND   CSECT',
  "M        DC    F'0'",
  "         LA    2,=H'2'",
  'N        DS    XL5',
  'FIRST    CSECT',
  'O        DS    H',
  'SECOND   CSECT',
  'P        DS    C',
  '         END',
].join('\n');

const bySymbol = (r) => Object.fromEntries(r.symbols.map((y) => [y.name, y]));

test('symbols take the location and length z390 gives them, across alignment, ORG, CNOP and a literal pool', () => {
  const y = bySymbol(locate(PROGRAM));
  const want = { A: [0x0a, 3], B: [0x0e, 2], C: [0x10, 3], D: [0x20, 8], E: [0x20, 4], I: [0x32, 3], J: [0x40, 4], K: [0x0b, 1], L: [0x44, 1], O: [0x46, 2] };
  for (const [name, [loc, len]] of Object.entries(want)) {
    assert.equal(y[name].section, 'FIRST', name);
    assert.equal(y[name].loc, loc, name);
    assert.equal(y[name].len, len, name);
  }
  assert.deepEqual([y.M.loc, y.N.loc, y.P.loc], [0, 8, 0x0d]);
  assert.equal(y.N.section, 'SECOND');
});

test('an EQU takes its value, and its length from an explicit operand or its leftmost term', () => {
  const y = bySymbol(locate(PROGRAM));
  assert.deepEqual([y.F.type, y.F.loc, y.F.len], ['ABS', 0x10, 1]);
  assert.deepEqual([y.G.loc, y.G.len], [0x0a, 5]);
  assert.deepEqual([y.H.loc, y.H.len], [0x10, 2]);
});

test('a dummy section starts at zero and its fields follow their alignment', () => {
  const r = locate(['REC      DSECT', 'REC1     DS    CL10', 'REC2     DS    PL4', 'REC3     DS    F', '         END'].join('\n'));
  const y = bySymbol(r);
  assert.deepEqual([y.REC1.loc, y.REC2.loc, y.REC3.loc], [0, 0x0a, 0x10]);
  assert.equal(r.sections[0].length, 0x14);
});

test('nothing after a macro call is placed in its section, and the line it follows is named', () => {
  const r = locate(['PROG     CSECT', 'A        DS    F', '         SAVE  (14,12)', 'B        DS    F', '         END'].join('\n'));
  const y = bySymbol(r);
  assert.equal(y.A.loc, 0);
  assert.equal(y.B.loc, null);
  assert.equal(y.B.after, 3);
});

test('V-type constants and EXTRN names are the externals a module needs', () => {
  const r = locate(['PROG     CSECT', '         L     15,=V(SUBRTN)', "OTHER    DC    V(SUB2)", '         END'].join('\n'));
  assert.deepEqual(r.esd.externals.map((e) => e.name).sort(), ['SUB2', 'SUBRTN']);
  const c = locate(['PROG     CSECT', '         CALL  PUT1,(A,B),VL', 'A        DS    F', 'B        DS    F', '         END'].join('\n'));
  assert.deepEqual(c.esd.externals.map((e) => `${e.how}:${e.name}`), ['CALL:PUT1']);
});

test('a constant holding &SYSDATE or &SYSTIME is placed at its fixed length, and another variable stops placement', () => {
  const y = bySymbol(locate(['PROG     CSECT', "         DC    C' &SYSDATE &SYSTIME '", 'AFTER    DS    F', '         END'].join('\n')));
  assert.equal(y.AFTER.loc, 16);
  const z = bySymbol(locate(['PROG     CSECT', "         DC    C'&NAME'", 'AFTER    DS    F', '         END'].join('\n')));
  assert.equal(z.AFTER.loc, null);
});
