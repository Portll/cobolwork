// Each case is graded against GnuCOBOL's own listing, captured once into a golden by
// diag/make-goldens.mjs. The compiler is not needed to run these tests, only to regenerate them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFile, parseSource, detectFormat } from '../lib/parser.mjs';
import { factsFromParse, alignProgramKeys, compareFacts } from '../diag/compare.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'parser');
const goldens = readdirSync(FIXTURES).filter(f => f.endsWith('.golden.json')).sort();

test('every case has a golden', () => {
  const cases = JSON.parse(readFileSync(join(FIXTURES, 'cases.json'), 'utf8'));
  assert.equal(goldens.length, cases.length, 'regenerate with node diag/make-goldens.mjs');
});

for (const g of goldens) {
  const golden = JSON.parse(readFileSync(join(FIXTURES, g), 'utf8'));
  const c = golden.case;
  test(`${c.file}: ${c.note}`, () => {
    const parsed = parseFile(join(FIXTURES, c.file), {
      format: c.format || 'fixed',
      std: c.std || 'default',
      includeDirs: (c.include || []).map(d => join(FIXTURES, d)),
      mainDir: FIXTURES,
      copyFormat: c.format || 'fixed',
      hostVariables: c.witness !== 'precompiled',
    });
    const mine = alignProgramKeys(factsFromParse(parsed), golden.programs);
    const witness = alignProgramKeys(golden.witness, golden.programs);
    const r = compareFacts(witness, mine);

    assert.equal(r.symbols.matched, r.symbols.witness, `data items the compiler reported and the parser did not: ${JSON.stringify(r.samples.symMissing)}`);
    assert.equal(r.symbols.matched, r.symbols.mine, `data items the parser reported and the compiler did not: ${JSON.stringify(r.samples.symExtra)}`);
    assert.equal(r.sizes.agree, r.sizes.compared, `sizes that disagree: ${JSON.stringify(r.samples.sizeWrong)}`);
    assert.equal(r.labels.matched, r.labels.witness, `labels missed: ${JSON.stringify(r.samples.labelMissing)}`);
    assert.equal(r.labels.matched, r.labels.mine, `labels invented: ${JSON.stringify(r.samples.labelExtra)}`);
    assert.equal(r.calls.matched, r.calls.witness, `calls missed: ${JSON.stringify(r.samples.callMissing)}`);
    assert.equal(r.calls.matched, r.calls.mine, `calls invented: ${JSON.stringify(r.samples.callExtra)}`);
    assert.equal(r.xref.stateAgree, r.xref.matched, `reference states that disagree: ${JSON.stringify(r.samples.stateWrong)}`);
    assert.equal(r.xref.witnessReceivingCaught, r.xref.witnessReceiving, `receiving fields missed: ${JSON.stringify(r.samples.receivingMissed)}`);
    assert.equal(r.xref.mineOnlyUnexplained, 0, 'receiving fields claimed for a verb the compiler does mark');
  });
}

// Every golden is a GnuCOBOL listing, so every program there compiled and names nothing undeclared.
test('a program GnuCOBOL compiled has no unresolved reference', () => {
  const cases = JSON.parse(readFileSync(join(FIXTURES, 'cases.json'), 'utf8'));
  for (const c of cases) {
    const parsed = parseFile(join(FIXTURES, c.file), {
      format: c.format || 'fixed', std: c.std || 'default',
      includeDirs: (c.include || []).map(d => join(FIXTURES, d)), mainDir: FIXTURES, copyFormat: c.format || 'fixed',
    });
    for (const p of parsed.programs) assert.deepEqual(p.unresolvedRefs, [], `${c.file} ${p.id}`);
  }
});

test('an unresolved reference is recorded with its name, file and line, and a supplied name is not', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 WS-A PIC 9(4).', '       PROCEDURE DIVISION.', '       MAIN-PARA.',
    '           IF EIBCALEN = ZERO MOVE WS-A TO RETURN-CODE END-IF',
    '           ADD WS-A TO WS-NOT-DECLARED', '           PERFORM MAIN-PARA.', ''].join('\n');
  const [p] = parseSource(src, 'P.cbl').programs;
  assert.deepEqual(p.unresolvedRefs, [{ name: 'WS-NOT-DECLARED', file: 'P.cbl', line: 9 }]);
});

test('a statement whose keyword has nothing after it is read, not thrown on', () => {
  const wrap = (stmt) => ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. K.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 A PIC X(10).', '       PROCEDURE DIVISION.', `           ${stmt}`, '           STOP RUN.', ''].join('\n');
  for (const stmt of ['ACCEPT.', 'PERFORM VARYING.', 'STRING A DELIMITED BY SIZE INTO A WITH POINTER.', 'INSPECT A TALLYING.',
    'READ A INTO.', 'CALL "X" RETURNING.', 'UNSTRING A INTO A WITH POINTER.']) {
    const [p] = parseSource(wrap(stmt), 'K.cbl', { format: 'fixed' }).programs;
    assert.ok(p.statements.length >= 2, stmt);
  }
});

test('OCCURS DYNAMIC is sized at its most and declares its capacity name; WITH C LINKAGE names no data', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. D.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 T.', '          05 E PIC X(5) OCCURS DYNAMIC CAPACITY IN E-CAP', '                FROM 1 TO 3 INITIALIZED.',
    '       01 U.', '          05 F PIC X(4) OCCURS DYNAMIC.', '       LINKAGE SECTION.', '       01 A PIC X.',
    '       PROCEDURE DIVISION WITH C LINKAGE USING A.', '           SET E-CAP TO 2', '           GOBACK.', ''].join('\n');
  const [p] = parseSource(src, 'D.cbl', { format: 'fixed' }).programs;
  assert.deepEqual(p.items.filter((i) => i.level === 1).map((i) => [i.name, i.size]), [['T', 15], ['U', 0], ['A', 1]]);
  assert.deepEqual(p.unresolvedRefs, []);
  assert.deepEqual(p.paramTokens.map((x) => x.tok.u), ['A']);
});

test('code past column 72 in a program without sequence numbers is free form; an identification tag there is not', () => {
  const head = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. W.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.'];
  const overflow = [...head, '       01 WS-A PIC X(10).', '       PROCEDURE DIVISION.',
    '           DISPLAY "A MESSAGE LONG ENOUGH TO RUN ACROSS THE RIGHT MARGIN" WS-A UPON CONSOLE', '           STOP RUN.'].join('\n');
  assert.equal(detectFormat(overflow), 'free');
  const tagged = [...head, `${'       01 WS-A PIC X(10).'.padEnd(72)}CHG0001`, '       PROCEDURE DIVISION.', '           STOP RUN.'].join('\n');
  assert.equal(detectFormat(tagged), 'fixed');
  const program = (line) => [...head, '       01 WS-A PIC X(10).', '       PROCEDURE DIVISION.', line, '           STOP RUN.'].join('\n');
  assert.equal(detectFormat(program(`${'           DISPLAY "A LITERAL THE MARGIN CUTS SHORT BEFORE IT ENDS, AND'.padEnd(72)}" WS-A`)), 'free');
  const continued = [...head, `${'       01 WS-L PIC X(20) VALUE "A LITERAL CONTINUED ON THE NEXT'.padEnd(72)}CHG0001`,
    '      -    " LINE".', '       PROCEDURE DIVISION.', '           STOP RUN.'].join('\n');
  assert.equal(detectFormat(continued), 'fixed');
  assert.equal(detectFormat(program('           MOVE SPACES TO WS-A *> an inline comment long enough to run past the margin')), 'fixed');
  assert.equal(detectFormat(program(`${'           MOVE SPACES TO WS-A.'.padEnd(74)}notes past the margin`)), 'fixed');
  assert.equal(detectFormat(program(`${'           MOVE SPACES TO WS-A'.padEnd(74)}   CHG0001`)), 'fixed');
  assert.equal(detectFormat(program(`${'           MOVE SPACES TO WS-A'.padEnd(74)}WS-B WS-C WS-D`)), 'free');
  assert.equal(detectFormat([head[0], '       REMARKS. A COMMENT ENTRY THAT RUNS PAST THE RIGHT MARGIN OF A FIXED-FORM PROGRAM.', ...head.slice(1)].join('\n')), 'fixed');
});

test('a tail past column 72 that closes a parenthesis is code, and a balanced note there is a tag', () => {
  const head = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. W.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 WS-IDX PIC 9(4).', '       01 WS-T.', '          05 WS-E PIC 9(4) OCCURS 10.', '       PROCEDURE DIVISION.'];
  const program = (line) => [...head, line, '           MOVE 1 TO WS-IDX', '           STOP RUN.'].join('\n');
  const toColumn72 = (code) => `           MOVE 1 TO${' '.repeat(72 - 20 - code.length)}${code}`;
  const cut = program(`${toColumn72('WS-E(WS-')}IDX)`);
  assert.equal(detectFormat(cut), 'free');
  const [p] = parseSource(cut, 'W.cbl').programs;
  assert.ok(p.statements.some((s) => s.verb === 'MOVE' && s.line === 10), 'the statement after the long line is its own');
  assert.equal(detectFormat(program(`${toColumn72('WS-IDX')}(CHG1)`)), 'fixed');
  assert.equal(detectFormat(program(`${toColumn72('WS-IDX')}(C)2019`)), 'fixed');
  assert.equal(detectFormat(program(`${toColumn72('WS-IDX')}CHG00012`)), 'fixed');
  const commented = [...head, '      * A COMMENT IN COLUMN 7', `${toColumn72('WS-E(WS-')}IDX)`, '           STOP RUN.'].join('\n');
  assert.equal(detectFormat(commented), 'variable', 'code past 72 among column-7 comments keeps the fixed columns');
  assert.equal(detectFormat(commented.replace('      * A COMMENT', '      *> A COMMENT')), 'free');
});

test('>>SET CONSTANT names a value as $SET CONSTANT does, and a CD declares its name', () => {
  const src = ['       >>SET CONSTANT DOGGY "Barky"', '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. K.', '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.', '       01 THEDOG PIC X(6) VALUE DOGGY.', '       >>SET CONSTANT PONY "White"', '       01 K1 PIC X(8).',
    '       COMMUNICATION SECTION.', '       CD COMMNAME FOR INITIAL INPUT.', '       01 CREC PIC X(87).', '       PROCEDURE DIVISION.',
    '           DISPLAY DOGGY PONY THEDOG.', '           DISABLE INPUT COMMNAME WITH KEY K1.', '           STOP RUN.', ''].join('\n');
  const [p] = parseSource(src, 'K.cbl', { format: 'fixed' }).programs;
  assert.deepEqual(p.unresolvedRefs.map((r) => r.name), []);
});

test('a CD declares the data-names of its clauses, of a list in their fixed order, and of its destination table', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. Q.', '       DATA DIVISION.', '       COMMUNICATION SECTION.',
    '       CD IN-CD FOR INITIAL INPUT', '           SYMBOLIC QUEUE IS IN-Q  SUB-QUEUE-1 IS IN-S1', '           MESSAGE DATE IS IN-DATE  TIME IN-TIME',
    '           TEXT LENGTH IS IN-LEN  END KEY IS IN-END', '           STATUS KEY IS IN-STAT  COUNT IS IN-COUNT.',
    '       CD TERM-CD FOR I-O', '           T-DATE, T-TIME, T-TERM, FILLER, T-END, T-STAT.',
    '       CD OUT-CD FOR OUTPUT', '           DESTINATION COUNT IS OUT-COUNT  TEXT LENGTH IS OUT-LEN',
    '           STATUS KEY IS OUT-STAT',
    '           DESTINATION TABLE OCCURS 3 TIMES INDEXED BY OUT-IX', '           ERROR KEY IS OUT-ERR  SYMBOLIC DESTINATION IS OUT-DEST.',
    '       PROCEDURE DIVISION.',
    '           MOVE IN-Q TO IN-S1 IN-DATE IN-TIME IN-LEN IN-END',
    '               IN-STAT IN-COUNT.',
    '           MOVE T-DATE TO T-TIME T-TERM T-END T-STAT OUT-COUNT',
    '               OUT-LEN OUT-STAT.',
    '           MOVE OUT-ERR (OUT-IX) TO OUT-DEST (OUT-IX) T-LEN.', '           STOP RUN.', ''].join('\n');
  const [p] = parseSource(src, 'Q.cbl', { format: 'fixed' }).programs;
  assert.deepEqual(p.unresolvedRefs.map((r) => r.name), ['T-LEN'], 'FILLER holds the I-O text length\'s place');
  assert.deepEqual(p.cds.map((c) => [c.name, c.kind]), [['IN-CD', 'INITIAL INPUT'], ['TERM-CD', 'I-O'], ['OUT-CD', 'OUTPUT']]);
  assert.deepEqual(p.cds[0].fields.filter((f) => /QUEUE|COUNT|TIME/.test(f.clause)), [
    { clause: 'SYMBOLIC QUEUE', name: 'IN-Q' }, { clause: 'SYMBOLIC SUB-QUEUE-1', name: 'IN-S1' },
    { clause: 'MESSAGE TIME', name: 'IN-TIME' }, { clause: 'MESSAGE COUNT', name: 'IN-COUNT' }]);
  assert.deepEqual(p.cds[1].fields.map((f) => f.clause), ['MESSAGE DATE', 'MESSAGE TIME', 'SYMBOLIC TERMINAL', 'END KEY', 'STATUS KEY']);
  assert.deepEqual(p.cds[2].indexNames, ['OUT-IX']);
  assert.deepEqual(p.communicationSection.line, 4);
});

test('SEARCH moves nothing from its table into its index', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. S.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 T.', '          05 E PIC X OCCURS 5 INDEXED BY IX.', '       01 K PIC X.', '       PROCEDURE DIVISION.',
    '           SEARCH E VARYING IX', '               AT END DISPLAY "NONE"', '               WHEN E (IX) = K DISPLAY IX', '           END-SEARCH', '           STOP RUN.', ''].join('\n');
  const [p] = parseSource(src, 'S.cbl', { format: 'fixed' }).programs;
  assert.deepEqual(p.statements.find((s) => s.verb === 'SEARCH').sources, []);
});

test('a comment-entry is text: a COPY, an apostrophe or a period in it is not code', () => {
  const fixed = parseFile(join(FIXTURES, 'idcomm.cbl'), { format: 'fixed', mainDir: FIXTURES });
  assert.deepEqual(fixed.copies, []);
  assert.deepEqual(fixed.diags, []);
  // In free form the entry is the rest of the header's line, and the line after it is code again.
  const free = parseSource(['IDENTIFICATION DIVISION.', 'PROGRAM-ID. F.', "AUTHOR. O'BRIEN.", 'COPY NEXTLINE.',
    'PROCEDURE DIVISION.', '    GOBACK.', ''].join('\n'), 'F.cbl', { format: 'free' });
  assert.deepEqual(free.diags.filter((d) => d.kind === 'unterminated-literal'), []);
  assert.deepEqual(free.copies.map((c) => c.name), ['NEXTLINE']);
});

test('a comma with no space after it separates, as the compiler reads it, and raises nothing', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. C.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 T.', '          05 R OCCURS 3.', '             10 E PIC X OCCURS 3.', '       01 I PIC 9.', '       01 J PIC 9.',
    '       01 K PIC X.', '          88 VOWEL VALUE "A","E","I".', '       LINKAGE SECTION.', '       01 A PIC X.', '       01 B PIC X.',
    '       PROCEDURE DIVISION USING A,B.', '           MOVE K TO E(I,J)', '           GOBACK.', ''].join('\n');
  const parsed = parseSource(src, 'C.cbl', { format: 'fixed' });
  assert.deepEqual(parsed.diags, []);
  const [p] = parsed.programs;
  assert.deepEqual(p.statements.find((s) => s.verb === 'MOVE').indexes.map((x) => x.tok.u), ['I', 'J']);
  assert.deepEqual(p.paramTokens.map((x) => x.tok.u), ['A', 'B']);
});

test('an EXEC SQL host variable is a reference, qualified by its dots, and written only by an INTO list', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. HV.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 WS-GRP.', '          05 WS-ID PIC S9(9) COMP.', '          05 WS-NAME PIC X(20).', '       01 WS-OTHER.', '          05 WS-NAME PIC X(20).',
    '       01 WS-IND PIC S9(4) COMP.', '       01 WS-FETCHED PIC X(8).', '       01 WS-NEW PIC X(8).', '       PROCEDURE DIVISION.',
    '           EXEC SQL SELECT NAME INTO :WS-GRP.WS-NAME :WS-IND', '               FROM T WHERE ID = :WS-ID END-EXEC',
    '           EXEC SQL INSERT INTO T (NAME) VALUES (:WS-NEW) END-EXEC', '           EXEC SQL FETCH C1 INTO :WS-FETCHED END-EXEC',
    '           GOBACK.', ''].join('\n');
  const read = (opts) => {
    const [p] = parseSource(src, 'HV.cbl', { format: 'fixed', ...opts }).programs;
    return Object.fromEntries(p.items.map((it) => [`${it.name}${it.parent ? ` OF ${it.parent.name}` : ''}`, `${it.refState}${it.receiving ? ' written' : ''}`]));
  };
  assert.deepEqual(read({}), { 'WS-GRP': 'refs', 'WS-ID OF WS-GRP': 'refs', 'WS-NAME OF WS-GRP': 'refs written', 'WS-OTHER': 'none',
    'WS-NAME OF WS-OTHER': 'none', 'WS-IND': 'refs written', 'WS-FETCHED': 'refs written', 'WS-NEW': 'refs' });
  assert.equal(read({ hostVariables: false })['WS-FETCHED'], 'none');
});

test('an EXEC CICS option argument is a reference, written where the option receives', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. CX.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 WS-REC.', '          05 WS-KEY PIC X(8).', '       01 WS-RESP PIC S9(8) COMP.', '       01 WS-OUT PIC X(80).',
    '       01 WS-IDLE PIC X.', '       01 MAPAI.', '          02 FLDI PIC X.', '       PROCEDURE DIVISION.',
    "           EXEC CICS READ DATASET('CUST') INTO(WS-REC) RIDFLD(WS-KEY)", '                RESP(WS-RESP) END-EXEC',
    "           EXEC CICS WRITEQ TS QUEUE('Q1') FROM(WS-OUT)", '                LENGTH(LENGTH OF WS-OUT) END-EXEC',
    "           EXEC CICS RECEIVE MAP('MAPA') MAPSET('MAPS') END-EXEC",
    '           EXEC CICS HANDLE CONDITION NOTFND(DONE) END-EXEC', '           GOBACK.', '       DONE.', '           GOBACK.', ''].join('\n');
  const read = (opts) => {
    const [p] = parseSource(src, 'CX.cbl', { format: 'fixed', ...opts }).programs;
    return Object.fromEntries(p.items.map((it) => [it.name, `${it.refState}${it.receiving ? ' written' : ''}`]));
  };
  assert.deepEqual(read({}), { 'WS-REC': 'refs written', 'WS-KEY': 'refs written', 'WS-RESP': 'refs written', 'WS-OUT': 'refs',
    'WS-IDLE': 'none', MAPAI: 'refs written', FLDI: 'parent' });
  assert.equal(read({ hostVariables: false })['WS-OUT'], 'none');
});

// cobc -std=ibm accepts hdrnop.cbl in the dialect's own source format but refuses it under
// -fformat=fixed, so fixed form has no golden; the default dialect refuses it in fixed form.
test('in fixed form a header in Area A ends the sentence before it under the IBM dialect only', () => {
  const src = readFileSync(join(FIXTURES, 'hdrnop.cbl'), 'latin1');
  const labels = (std) => parseSource(src, 'hdrnop.cbl', { format: 'fixed', std }).programs[0].labels.map((l) => `${l.kind}:${l.name}`);
  assert.deepEqual(labels('ibm'), ['P:MAIN-PARA', 'P:STEP-ONE', 'P:STEP-TWO', 'S:LAST-PART', 'P:LAST-PARA']);
  assert.ok(!labels('default').includes('P:STEP-TWO'));
});

test('a file the parser cannot read is refused, not reported as empty', () => {
  assert.throws(() => parseFile(join(FIXTURES, 'no-such-file.cbl')), (e) => e.code === 'ENOENT');
});

test('UNSTRING writes every receiver and each field its DELIMITER IN, COUNT IN, POINTER and TALLYING IN phrases name', () => {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. U.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
    '       01 A PIC X(80).', '       01 R.', '          05 B PIC X(80).', '          05 E PIC X(80).', '       01 D PIC X.',
    '       01 C PIC 9(4) COMP.', '       01 C2 PIC 9(4) COMP.', '       01 P PIC 9(4) COMP.', '       01 T PIC 9(4) COMP.', '       PROCEDURE DIVISION.',
    '           UNSTRING A DELIMITED BY ","', '               INTO B IN R DELIMITER IN D COUNT IN C',
    '               E COUNT C2 WITH POINTER P TALLYING IN T END-UNSTRING', '           GOBACK.', ''].join('\n');
  const [p] = parseSource(src, 'U.cbl').programs;
  const st = p.statements.find((s) => s.verb === 'UNSTRING');
  assert.deepEqual(st.targets.map((t) => t.u).filter((u) => u !== 'IN'), ['B', 'D', 'C', 'E', 'C2', 'P', 'T']);
});
