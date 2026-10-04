import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-bmsflow-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, text);
  }
  return root;
};
// Fixed format: code ends at column 72, and a fixture line past it would lose its tail.
const cobol = (lines) => lines.map((l) => { if (l.length > 65) throw new Error(`past column 72: ${l}`); return `       ${l}`; }).join('\n') + '\n';

// A list screen whose rows the program fills: ROWID1 is protected and sent back (FSET), SEL1 is where
// the user marks a row, OPT a digits-only option. The layout is the one CICS generates for it.
const MAP = [
  'LISTS    DFHMSD TYPE=&&SYSPARM,MODE=INOUT,LANG=COBOL,TIOAPFX=YES',
  'LISTA    DFHMDI SIZE=(24,80)',
  'SEL1     DFHMDF POS=(5,1),LENGTH=1,ATTRB=(UNPROT,IC)',
  'ROWID1   DFHMDF POS=(5,3),LENGTH=10,ATTRB=(ASKIP,FSET)',
  'OPT      DFHMDF POS=(20,1),LENGTH=2,ATTRB=(UNPROT,NUM)',
  '         DFHMSD TYPE=FINAL',
  '         END',
].join('\n') + '\n';
const SYMBOLIC = cobol([
  '01  LISTAI.', '    02  FILLER PIC X(12).',
  '    02  SEL1L COMP PIC S9(4).', '    02  SEL1F PIC X.', '    02  FILLER REDEFINES SEL1F.', '      03 SEL1A PIC X.', '    02  SEL1I PIC X(1).',
  '    02  ROWID1L COMP PIC S9(4).', '    02  ROWID1F PIC X.', '    02  FILLER REDEFINES ROWID1F.', '      03 ROWID1A PIC X.', '    02  ROWID1I PIC X(10).',
  '    02  OPTL COMP PIC S9(4).', '    02  OPTF PIC X.', '    02  FILLER REDEFINES OPTF.', '      03 OPTA PIC X.', '    02  OPTI PIC X(2).',
]);
const list = ({ key = 'ROWID1I', idx = 'OPTI', pgm = "'VIEWP'", map = "MAP('LISTA')", ws = [] } = {}) => cobol([
  'IDENTIFICATION DIVISION.', 'PROGRAM-ID. LISTP.', 'DATA DIVISION.', 'WORKING-STORAGE SECTION.',
  '01 WS-PGM PIC X(8).', '01 WS-IDX PIC 99.', '01 WS-OUT PIC X(4).',
  '01 WS-TABLE.', '   05 WS-ENTRY PIC X(4) OCCURS 5 TIMES.',
  '01 CA.', '   05 CA-SELECTED PIC X(10).', ...ws,
  'COPY LISTS.',
  'PROCEDURE DIVISION.',
  `    EXEC CICS RECEIVE ${map} MAPSET('LISTS')`,
  '        INTO(LISTAI) END-EXEC.',
  `    MOVE ${key} TO CA-SELECTED.`,
  `    MOVE ${idx} TO WS-IDX.`,
  '    MOVE WS-ENTRY(WS-IDX) TO WS-OUT.',
  `    MOVE ${pgm} TO WS-PGM.`,
  '    EXEC CICS XCTL PROGRAM(WS-PGM) COMMAREA(CA) END-EXEC.',
  '    GOBACK.',
]);
// hold: READ UPDATE; then: what follows it, on the same file or another; byKey: DELETE by its own key.
const THEN = { rewrite: ["    EXEC CICS REWRITE FILE('ACCTS') FROM(REC)", '        END-EXEC.'], delete: ["    EXEC CICS DELETE FILE('ACCTS') END-EXEC."], other: ["    EXEC CICS REWRITE FILE('AUDIT') FROM(REC)", '        END-EXEC.'] };
const view = ({ check = false, hold = false, then = null, byKey = false } = {}) => cobol([
  'IDENTIFICATION DIVISION.', 'PROGRAM-ID. VIEWP.', 'DATA DIVISION.', 'WORKING-STORAGE SECTION.',
  '01 CA.', '   05 CA-SELECTED PIC X(10).', '01 WS-KEY PIC X(10).', '01 REC PIC X(80).',
  'LINKAGE SECTION.', '01 DFHCOMMAREA PIC X(10).',
  'PROCEDURE DIVISION.',
  '    MOVE DFHCOMMAREA TO CA.',
  '    MOVE CA-SELECTED TO WS-KEY.',
  ...(check ? ['    IF WS-KEY IS NOT NUMERIC', '        EXEC CICS RETURN END-EXEC', '    END-IF.'] : []),
  ...(byKey ? ["    EXEC CICS DELETE FILE('ACCTS')", '        RIDFLD(WS-KEY) END-EXEC.']
    : ["    EXEC CICS READ FILE('ACCTS') INTO(REC)", `        RIDFLD(WS-KEY)${hold ? ' UPDATE' : ''} END-EXEC.`]),
  ...(then ? THEN[then] : []),
  '    EXEC CICS RETURN END-EXEC.',
]);
const estate = (over = {}) => tree({ 'bms/LISTS.bms': MAP, 'cpy/LISTS.cpy': SYMBOLIC, 'cbl/LISTP.cbl': list(over.list), 'cbl/VIEWP.cbl': view(over.view), ...(over.files || {}) });
const keys = (r) => r.findings.filter((f) => f.rule === 'cics-protected-field-to-record-key');

test('a key the program kept in a protected field decides the record another program reads', () => {
  const r = scan(estate());
  const [f] = keys(r);
  assert.ok(f, 'reported');
  assert.equal(f.sev, 'med');
  assert.equal(f.cwe, 'CWE-639');
  assert.equal(f.program, 'VIEWP');
  assert.equal(f.crossProgram, true, 'through the COMMAREA of an XCTL whose program is a data name');
  assert.match(f.detail, /returns ROWID1I, field ROWID1 of map LISTA in mapset LISTS, which the map marks ASKIP with FSET at cbl\/LISTP\.cbl:\d+ reaches EXEC CICS READ RIDFLD\(WS-KEY\)/);
  assert.deepEqual(f.trace.map((t) => `${t.program}:${t.item}`).slice(0, 2), ['LISTP:ROWID1I', 'LISTP:CA-SELECTED']);
  assert.equal(r.summary.mapsReceived, 1);
  assert.equal(r.summary.protectedFields, 1);
  assert.equal(r.summary.mapsNotRead, undefined);
});

test('a key the user typed is how a lookup works, and is not reported', () => {
  assert.equal(keys(scan(estate({ list: { key: 'SEL1I' } }))).length, 0);
});

test('a check on the key does not lower it: a well-formed key is still someone else', () => {
  const r = scan(estate({ view: { check: true } }));
  const [f] = keys(r);
  assert.equal(f.sev, 'med');
  assert.equal(f.guardedFrom, undefined, 'not lowered');
  assert.equal(f.guard, undefined);
  assert.equal((r.checked || []).filter((c) => c.rule === 'cics-protected-field-to-record-key').length, 0, 'not stopped');
});

test('a map named through a constant is read against its source', () => {
  const r = scan(estate({ list: { map: 'MAP(WS-MAP)', ws: ["01 WS-MAP PIC X(8) VALUE 'LISTA'."] } }));
  assert.equal(keys(r).length, 1);
  assert.equal(r.summary.mapsNotRead, undefined);
});

test('a map whose source is not in the tree is counted, not read as clean', () => {
  const root = tree({ 'cpy/LISTS.cpy': SYMBOLIC, 'cbl/LISTP.cbl': list(), 'cbl/VIEWP.cbl': view() });
  const r = scan(root);
  assert.equal(keys(r).length, 0);
  assert.match(r.summary.mapsNotRead, /^1 of 1 RECEIVE MAP statement\(s\) could not be read against their map: 1 name a map whose BMS source is not in the tree/);
});

test('input from a field the map restricts to digits says so where it is used as a subscript', () => {
  const f = scan(estate()).findings.find((x) => x.rule === 'cics-terminal-to-subscript');
  assert.ok(f);
  assert.match(f.detail, /; it starts in OPTI, field OPT of map LISTA, which the map marks NUM: the terminal enforces that, CICS does not, and a modified client ignores it$/);
  assert.equal(f.screen.field, 'OPT');
});

test('a protected field reaching any other sink is the terminal finding, with the map named, not a second one', () => {
  const r = scan(estate({ list: { idx: 'ROWID1I', pgm: 'ROWID1I' } }));
  for (const rule of ['cics-terminal-to-subscript', 'cics-terminal-to-cics-dynamic-transfer']) {
    assert.match(r.findings.find((x) => x.rule === rule).detail, /it starts in ROWID1I, field ROWID1 of map LISTA, which the map marks ASKIP:/, rule);
  }
  assert.deepEqual(r.findings.filter((x) => x.rule.startsWith('cics-protected-field-to-') && x.rule !== 'cics-protected-field-to-record-key'), []);
});

// A REWRITE or DELETE carries no key: the READ UPDATE before it chose the record.
const updates = (r) => r.findings.filter((f) => f.rule === 'cics-protected-field-to-record-update');
test('a protected key that chooses a record the program then rewrites or deletes is the higher claim', () => {
  for (const [then, verb] of [['rewrite', 'rewrites'], ['delete', 'deletes']]) {
    const r = scan(estate({ view: { hold: true, then } }));
    const [f] = updates(r);
    assert.equal(f.sev, 'high', then);
    assert.ok(f.detail.endsWith(`reaches EXEC CICS READ UPDATE RIDFLD(WS-KEY), which decides which record the program then ${verb}`), f.detail);
    assert.equal(keys(r).length, 0, 'one claim for the one READ');
  }
  const [byKey] = updates(scan(estate({ view: { byKey: true } })));
  assert.match(byKey.detail, /reaches EXEC CICS DELETE RIDFLD\(WS-KEY\), which decides which record it deletes$/);
});

test('a READ UPDATE of a record the program never changes, or changes in another file, stays a read', () => {
  for (const view of [{ hold: true }, { hold: true, then: 'other' }]) {
    const r = scan(estate({ view }));
    assert.equal(updates(r).length, 0, JSON.stringify(view));
    assert.equal(keys(r)[0].sev, 'med');
  }
});

test('a protected key the program puts in a field the user may type into is typed input by the time it is used', () => {
  const retyped = cobol([
    'IDENTIFICATION DIVISION.', 'PROGRAM-ID. LISTP.', 'DATA DIVISION.', 'WORKING-STORAGE SECTION.',
    '01 CA.', '   05 CA-SELECTED PIC X(10).',
    'COPY LISTS.',
    'PROCEDURE DIVISION.',
    "    EXEC CICS RECEIVE MAP('LISTA') MAPSET('LISTS')",
    '        INTO(LISTAI) END-EXEC.',
    '    MOVE ROWID1I TO OPTI.',
    '    MOVE OPTI TO CA-SELECTED.',
    "    EXEC CICS XCTL PROGRAM('VIEWP') COMMAREA(CA) END-EXEC.",
  ]);
  assert.equal(keys(scan(estate({ files: { 'cbl/LISTP.cbl': retyped } }))).length, 0);
});

test('a mapset the tree holds only as BMS source is read through the symbolic map BMS generates from it', () => {
  const sites = (r) => r.findings.map((f) => `${f.rule} ${f.path}:${f.line}`).sort();
  const withCopybook = scan(estate());
  const root = tree({ 'bms/LISTS.bms': MAP, 'cbl/LISTP.cbl': list(), 'cbl/VIEWP.cbl': view() });
  const fromBms = scan(root);
  assert.ok(withCopybook.findings.length > 0);
  assert.deepEqual(sites(fromBms), sites(withCopybook));
});
