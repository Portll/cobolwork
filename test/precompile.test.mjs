import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { precompile } from '../lib/precompile.mjs';
import { hostVariableRoles } from '../lib/embedded-sql.mjs';
import { parseSource } from '../lib/parser.mjs';
import { parseBms } from '../lib/bms.mjs';
import './pin-machine.mjs';

const hasCobc = spawnSync('cobc', ['--version']).status === 0;
const program = (ws, body) => [
  '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. P.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.',
  '           EXEC SQL INCLUDE SQLCA END-EXEC.', ...ws, '       PROCEDURE DIVISION.', ...body, '           GOBACK.',
  '       FAIL-PARA.', '           GOBACK.', ''].join('\n');
const WS = ['       01 WS-ID   PIC X(8).', '       01 WS-REC.', '          05 WS-NAME PIC X(30).', '       01 WS-IND  PIC S9(4) COMP.', '       01 WS-SQL  PIC X(200).'];
// The translation of one statement, as the words it became.
const words = (text) => text.replace(/\s+/g, ' ').trim();
// A statement laid out in area B, wrapped before column 73.
const exec = (sql) => {
  const lines = ['           EXEC SQL'];
  for (const w of `${sql} END-EXEC.`.split(' ')) {
    if (lines.length === 1 || lines[lines.length - 1].length + 1 + w.length > 72) lines.push(`               ${w}`);
    else lines[lines.length - 1] += ` ${w}`;
  }
  return lines;
};
const callOf = (out) => { const w = words(out.text.split('\n').slice(9).join(' ')); return w.slice(w.indexOf('CALL'), w.indexOf(' .') + 2); };

test('INTO receives by reference and the rest is sent by content, qualified and with indicators', () => {
  const r = precompile(program(WS, ['           EXEC SQL SELECT NAME INTO :WS-REC.WS-NAME :WS-IND', '               FROM CUST WHERE ID = :WS-ID END-EXEC.']));
  assert.equal(callOf(r), "CALL 'CW-SQL-SELECT' USING BY CONTENT WS-ID BY REFERENCE WS-NAME OF WS-REC WS-IND SQLCA .");
});

test('a cursor sends its host variables when it is opened, and FETCH receives', () => {
  const r = precompile(program([...WS, '           EXEC SQL DECLARE C1 CURSOR FOR', '               SELECT NAME FROM CUST WHERE ID > :WS-ID END-EXEC.'],
    ['           EXEC SQL OPEN C1 END-EXEC.', '           EXEC SQL FETCH C1 INTO :WS-NAME END-EXEC.']));
  const text = words(r.text);
  assert.match(text, /CALL 'CW-SQL-OPEN' USING BY CONTENT WS-ID BY REFERENCE SQLCA/);
  assert.match(text, /CALL 'CW-SQL-FETCH' USING BY REFERENCE WS-NAME SQLCA/);
});

test('dynamic SQL sends its statement, and a procedure CALL reads and may write each lone variable', () => {
  const r = precompile(program(WS, ['           EXEC SQL EXECUTE IMMEDIATE :WS-SQL END-EXEC.',
    ...exec('CALL :WS-SQL (:WS-ID, :WS-IND + 1, :WS-NAME INDICATOR :WS-IND)')]));
  const text = words(r.text);
  assert.match(text, /CALL 'CW-SQL-EXECUTE-IMMEDIATE' USING BY CONTENT WS-SQL BY REFERENCE SQLCA/);
  assert.match(text, /CALL 'CW-SQL-CALL' USING BY CONTENT WS-SQL WS-ID WS-IND WS-NAME BY REFERENCE WS-ID WS-NAME WS-IND SQLCA/);
});

test('INTO writes only host variables, and a variable read and assigned is in both lists', () => {
  const call = (sql) => { const w = words(precompile(program(WS, exec(sql))).text); const at = w.indexOf('CALL'); return w.slice(at, w.indexOf(' .', at)); };
  assert.equal(call('INSERT INTO CUST (ID, NAME) VALUES (:WS-ID, :WS-NAME)'), "CALL 'CW-SQL-INSERT' USING BY CONTENT WS-ID WS-NAME BY REFERENCE SQLCA");
  assert.equal(call('SELECT ID INTO :WS-ID FROM CUST WHERE ID > :WS-ID'), "CALL 'CW-SQL-SELECT' USING BY CONTENT WS-ID BY REFERENCE WS-ID SQLCA");
  assert.equal(call('SET :WS-IND = :WS-IND + 1'), "CALL 'CW-SQL-SET' USING BY CONTENT WS-IND BY REFERENCE WS-IND SQLCA");
  assert.equal(call('SET (:WS-ID, :WS-NAME) = (\'A\', \'B\')'), "CALL 'CW-SQL-SET' USING BY REFERENCE WS-ID WS-NAME SQLCA");
  assert.equal(call('ASSOCIATE LOCATORS (:WS-ID) WITH PROCEDURE :WS-NAME'), "CALL 'CW-SQL-ASSOCIATE' USING BY CONTENT WS-NAME BY REFERENCE WS-ID SQLCA");
  assert.equal(call('FETCH C1 USING DESCRIPTOR :WS-REC'), call('FETCH C1 INTO DESCRIPTOR :WS-REC'));
  assert.equal(call('OPEN C1 USING DESCRIPTOR :WS-REC'), "CALL 'CW-SQL-OPEN' USING BY CONTENT WS-REC BY REFERENCE SQLCA");
  assert.equal(call('WITH T AS (SELECT 1 AS N FROM CUST) SELECT N INTO :WS-ID FROM T'), "CALL 'CW-SQL-SELECT' USING BY REFERENCE WS-ID SQLCA");
  assert.equal(call('DECLARE GLOBAL TEMPORARY TABLE SESSION.T (N INT)'), "CALL 'CW-SQL-DECLARE-GLOBAL-TEMPORARY' USING BY REFERENCE SQLCA");
});

test('WHENEVER applies in listing order after each later statement, until CONTINUE ends it', () => {
  const r = precompile(program(WS, [
    '           EXEC SQL WHENEVER SQLERROR GO TO FAIL-PARA END-EXEC.',
    '           EXEC SQL COMMIT END-EXEC.',
    '           EXEC SQL WHENEVER SQLERROR CONTINUE END-EXEC.',
    '           EXEC SQL ROLLBACK END-EXEC.',
  ]));
  const text = words(r.text);
  assert.match(text, /CALL 'CW-SQL-COMMIT' USING BY REFERENCE SQLCA IF SQLCODE < 0 GO TO FAIL-PARA END-IF \./);
  assert.match(text, /CALL 'CW-SQL-ROLLBACK' USING BY REFERENCE SQLCA \./);
});

test('a WHENEVER label may carry a colon, and the tests come in one fixed order', () => {
  const r = precompile(program(WS, [
    '           EXEC SQL WHENEVER SQLWARNING GO TO FAIL-PARA END-EXEC.',
    '           EXEC SQL WHENEVER SQLERROR GOTO :FAIL-PARA END-EXEC.',
    '           EXEC SQL COMMIT END-EXEC.',
  ]));
  assert.match(words(r.text), /CALL 'CW-SQL-COMMIT' USING BY REFERENCE SQLCA IF SQLCODE < 0 GO TO FAIL-PARA END-IF IF SQLWARN0 = 'W'/);
});

test('an SQLCA written out is found, and without one SQLCODE carries the status', () => {
  const written = precompile(program([...WS, '       01 SQLCA.', '          05 SQLCODE PIC S9(9) COMP-5.'],
    ['           EXEC SQL WHENEVER SQLERROR GO TO FAIL-PARA END-EXEC.', '           EXEC SQL COMMIT END-EXEC.']).replace(/.*INCLUDE SQLCA.*\n/, ''));
  assert.match(words(written.text), /CALL 'CW-SQL-COMMIT' USING BY REFERENCE SQLCA IF SQLCODE < 0 GO TO FAIL-PARA END-IF/);
  assert.deepEqual(written.copybooks, {});
  const bare = precompile(program([...WS, '       01 SQLCODE PIC S9(9) COMP-5.'],
    ['           EXEC SQL WHENEVER SQLWARNING GO TO FAIL-PARA END-EXEC.', '           EXEC SQL COMMIT END-EXEC.']).replace(/.*INCLUDE SQLCA.*\n/, ''));
  assert.match(words(bare.text), /CALL 'CW-SQL-COMMIT' USING BY REFERENCE SQLCODE IF SQLCODE > 0 AND SQLCODE NOT = 100 GO TO FAIL-PARA END-IF/);
});

test('the SQLCA stand-in is Db2 for z/OS\'s 136 bytes, and INCLUDE SQLDA brings the SQLDA', () => {
  const src = program([...WS, '           EXEC SQL INCLUDE SQLDA END-EXEC.'], ['           DISPLAY SQLCADE SQLSTAT SQLWARNA SQLNAMEC (1).']);
  const r = precompile(src);
  const withBooks = r.text.replace(/COPY SQLCA +\./, r.copybooks.SQLCA).replace(/COPY SQLDA +\./, r.copybooks.SQLDA);
  const sqlca = parseSource(withBooks, 'P.cbl').programs[0].items.find((it) => it.name === 'SQLCA');
  assert.equal(sqlca.size, 136);
  if (!hasCobc) return;
  const dir = mkdtempSync(join(tmpdir(), 'cw-precompile-'));
  writeFileSync(join(dir, 'P.cbl'), r.text);
  for (const [name, text] of Object.entries(r.copybooks)) writeFileSync(join(dir, `${name}.cpy`), text);
  const out = spawnSync('cobc', ['-fsyntax-only', '-I', dir, join(dir, 'P.cbl')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
});

test('EXEC and SQL on separate lines open a block, as the coprocessor allows', () => {
  const r = precompile(program(WS, ['           EXEC', '             SQL COMMIT END-EXEC.']));
  assert.equal(r.stats.translated, 1);
  assert.doesNotMatch(r.text, /\bSQL COMMIT\b/);
});

test('INCLUDE becomes COPY, and a declaration is blanked with its period', () => {
  const r = precompile(program([...WS, '           EXEC SQL DECLARE CUST TABLE (ID CHAR(8)) END-EXEC.'], ['           CONTINUE.']));
  const lines = r.text.split('\n');
  assert.match(lines[4], /^ {11}COPY SQLCA +\.$/);
  assert.equal(lines[10].trim(), '', 'the declaration and its period are gone');
  assert.ok(r.copybooks.SQLCA.includes('05 SQLCODE PIC S9(9) COMP-5.'));
});

test('a tab-indented fixed-format block is read at the columns its tabs expand to', () => {
  const r = precompile(program(WS, ['\t\tEXEC SQL COMMIT', '\t\tEND-EXEC.']), { format: 'fixed' });
  assert.equal(callOf(r), "CALL 'CW-SQL-COMMIT' USING BY REFERENCE SQLCA .");
});

test('EXEC SQL in a comment line or a literal is not a statement', () => {
  const r = precompile(program(WS, ["      *    EXEC SQL COMMIT END-EXEC.", "           DISPLAY 'EXEC SQL COMMIT END-EXEC'."]));
  assert.equal(r.stats.translated, 0);
  assert.match(r.text, /DISPLAY 'EXEC SQL COMMIT END-EXEC'\./);
});

test('a host-variable array passes its first element, with a subscript for each OCCURS above it', () => {
  const src = program([...WS, '       01 TBL.', '          05 ROW OCCURS 10.', '             10 T-NAME PIC X(30).', '             10 T-GRID PIC X OCCURS 3.',
    '          05 T-ONE PIC X OCCURS 1.'],
  ['           EXEC SQL FETCH NEXT ROWSET FROM C1 FOR 10 ROWS', '               INTO :TBL.T-NAME, :T-GRID, :T-ONE END-EXEC.']);
  const items = parseSource(src, 'P.cbl').programs.flatMap((p) => p.items);
  assert.equal(callOf(precompile(src, { items })), "CALL 'CW-SQL-FETCH' USING BY REFERENCE T-NAME OF TBL (1) T-GRID (1 1) T-ONE (1) SQLCA .");
  if (!hasCobc) return;
  const r = precompile(src, { items });
  const dir = mkdtempSync(join(tmpdir(), 'cw-precompile-'));
  writeFileSync(join(dir, 'P.cbl'), r.text);
  writeFileSync(join(dir, 'SQLCA.cpy'), r.copybooks.SQLCA);
  const out = spawnSync('cobc', ['-fsyntax-only', '-I', dir, join(dir, 'P.cbl')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
});

test('every output line maps to the source line it came from, and a translation that fits keeps the count', () => {
  const src = program(WS, ['           EXEC SQL COMMIT END-EXEC.']);
  const r = precompile(src);
  assert.equal(r.map.length, r.text.split('\n').length);
  assert.equal(r.text.split('\n').length, src.split('\n').length);
  const spilledSrc = program(WS, ['           EXEC SQL WHENEVER SQLERROR GO TO FAIL-PARA END-EXEC.', '           EXEC SQL COMMIT END-EXEC.']);
  const spilled = precompile(spilledSrc);
  const at = spilled.text.split('\n').findIndex((l) => /GO TO FAIL-PARA END-IF/.test(l));
  assert.equal(spilled.map[at], spilledSrc.split('\n').findIndex((l) => /COMMIT/.test(l)) + 1, 'the spilled test maps to the COMMIT');
});

test('cobc accepts the translation', { skip: !hasCobc && 'cobc is not installed' }, () => {
  const r = precompile(program([...WS, '           EXEC SQL DECLARE C1 CURSOR FOR', '               SELECT NAME FROM CUST WHERE ID > :WS-ID END-EXEC.'], [
    '           EXEC SQL WHENEVER SQLERROR GO TO FAIL-PARA END-EXEC.',
    '           EXEC SQL SELECT NAME INTO :WS-REC.WS-NAME :WS-IND', '               FROM CUST WHERE ID = :WS-ID END-EXEC.',
    '           EXEC SQL OPEN C1 END-EXEC.', '           EXEC SQL FETCH C1 INTO :WS-NAME END-EXEC.', '           EXEC SQL COMMIT END-EXEC.',
  ]));
  const dir = mkdtempSync(join(tmpdir(), 'cw-precompile-'));
  writeFileSync(join(dir, 'P.cbl'), r.text);
  for (const [name, text] of Object.entries(r.copybooks)) writeFileSync(join(dir, `${name}.cpy`), text);
  const out = spawnSync('cobc', ['-fsyntax-only', '-I', dir, join(dir, 'P.cbl')], { encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
});

const cicsProgram = (ws, body, { linkage = null } = {}) => [
  '       IDENTIFICATION DIVISION.', '       PROGRAM-ID. C.', '       DATA DIVISION.', '       WORKING-STORAGE SECTION.', ...ws,
  ...(linkage ? ['       LINKAGE SECTION.', ...linkage] : []), '       PROCEDURE DIVISION.', ...body, '           GOBACK.',
  '       FAIL-PARA.', '           GOBACK.', ''].join('\n');
const CWS = ['       01 WS-KEY  PIC X(8).', '       01 WS-REC  PIC X(80).', '       01 WS-RESP PIC S9(8) COMP.', '       01 WS-LEN  PIC S9(4) COMP.',
  '       01 WS-PGM  PIC X(8).', '       01 WS-TIME PIC S9(15) COMP-3.'];
// A CICS command laid out in area B, wrapped before column 73.
const cicsExec = (cmd) => exec(cmd).map((l, i) => (i ? l : l.replace('EXEC SQL', 'EXEC CICS')));
// The CALL a program's translation holds for a command, up to its sentence's period.
const callFor = (r, name) => { const w = words(r.text); const at = w.indexOf(`CALL '${name}'`); return at < 0 ? null : w.slice(at, w.indexOf(' .', at)); };
const accepts = (r) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-precompile-'));
  writeFileSync(join(dir, 'C.cbl'), r.text);
  for (const [name, text] of Object.entries(r.copybooks)) writeFileSync(join(dir, `${name}.cpy`), text);
  return spawnSync('cobc', ['-fsyntax-only', '-I', dir, join(dir, 'C.cbl')], { encoding: 'utf8' });
};

test('a CICS command sends BY CONTENT and receives BY REFERENCE by its options, then passes the EIB', () => {
  const r = precompile(cicsProgram(CWS, [
    ...cicsExec("READ FILE('CUSTF') INTO(WS-REC) RIDFLD(WS-KEY) LENGTH(WS-LEN) UPDATE RESP(WS-RESP)"),
    ...cicsExec("STARTBR FILE('CUSTF') RIDFLD(WS-KEY) GTEQ"),
    ...cicsExec("READNEXT FILE('CUSTF') INTO(WS-REC) RIDFLD(WS-KEY)"),
    ...cicsExec("WRITE FILE('CUSTF') FROM(WS-REC) RIDFLD(WS-KEY) LENGTH(80)"),
    ...cicsExec('ASKTIME ABSTIME(WS-TIME)'),
    ...cicsExec('FORMATTIME ABSTIME(WS-TIME) YYYYMMDD(WS-KEY)'),
  ]));
  assert.equal(callFor(r, 'CW-CICS-READ'), "CALL 'CW-CICS-READ' USING BY CONTENT 'CUSTF' BY REFERENCE WS-REC WS-KEY WS-LEN WS-RESP DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-STARTBR'), "CALL 'CW-CICS-STARTBR' USING BY CONTENT 'CUSTF' WS-KEY BY REFERENCE DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-READNEXT'), "CALL 'CW-CICS-READNEXT' USING BY CONTENT 'CUSTF' BY REFERENCE WS-REC WS-KEY DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-WRITE'), "CALL 'CW-CICS-WRITE' USING BY CONTENT 'CUSTF' WS-REC 80 BY REFERENCE WS-KEY DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-ASKTIME'), "CALL 'CW-CICS-ASKTIME' USING BY REFERENCE WS-TIME DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-FORMATTIME'), "CALL 'CW-CICS-FORMATTIME' USING BY CONTENT WS-TIME BY REFERENCE WS-KEY DFHEIBLK");
});

test('a LINK commarea comes back, an XCTL or RETURN one only goes, and literals and LENGTH OF are sent', () => {
  const r = precompile(cicsProgram(CWS, [
    ...cicsExec('LINK PROGRAM(WS-PGM) COMMAREA(WS-REC) LENGTH(LENGTH OF WS-REC)'),
    ...cicsExec("XCTL PROGRAM('NEXTPGM') COMMAREA(WS-REC)"),
    ...cicsExec("RETURN TRANSID('TRN1') COMMAREA(WS-REC) LENGTH(80)"),
  ]));
  assert.equal(callFor(r, 'CW-CICS-LINK'), "CALL 'CW-CICS-LINK' USING BY CONTENT WS-PGM LENGTH OF WS-REC BY REFERENCE WS-REC DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-XCTL'), "CALL 'CW-CICS-XCTL' USING BY CONTENT 'NEXTPGM' WS-REC BY REFERENCE DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-RETURN'), "CALL 'CW-CICS-RETURN' USING BY CONTENT 'TRN1' WS-REC 80 BY REFERENCE DFHEIBLK");
});

test('a command is named with the option that tells it from its namesakes, and one the table lacks writes every name', () => {
  const r = precompile(cicsProgram(CWS, [
    ...cicsExec("SEND MAP('MAP1') MAPSET('SET1') FROM(WS-REC) ERASE"),
    ...cicsExec("READQ QUEUE('TSQ1') INTO(WS-REC) LENGTH(WS-LEN)"),
    ...cicsExec("WRITEQ TD QUEUE('CSSL') FROM(WS-REC)"),
    ...cicsExec("SPOOLOPEN OUTPUT NODE('CUSTF') TOKEN(WS-RESP)"),
  ]));
  assert.equal(callFor(r, 'CW-CICS-SEND-MAP'), "CALL 'CW-CICS-SEND-MAP' USING BY CONTENT 'MAP1' 'SET1' WS-REC BY REFERENCE DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-READQ-TS'), "CALL 'CW-CICS-READQ-TS' USING BY CONTENT 'TSQ1' BY REFERENCE WS-REC WS-LEN DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-WRITEQ-TD'), "CALL 'CW-CICS-WRITEQ-TD' USING BY CONTENT 'CSSL' WS-REC BY REFERENCE DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-SPOOLOPEN-OUTPUT'), "CALL 'CW-CICS-SPOOLOPEN-OUTPUT' USING BY CONTENT 'CUSTF' BY REFERENCE WS-RESP DFHEIBLK");
  assert.equal(r.stats.unknown, 1);
});

test('a command named by its words in order wins over an option that names another, and DATASET is FILE', () => {
  const r = precompile(cicsProgram(CWS, [
    ...cicsExec("INQUIRE TRANSACTION(WS-KEY) PROGRAM(WS-PGM)"),
    ...cicsExec("WEB READ HTTPHEADER(WS-KEY) NAMELENGTH(WS-LEN) VALUE(WS-REC) VALUELENGTH(WS-RESP)"),
    ...cicsExec("INQUIRE FILE('CUSTF') OPENSTATUS(WS-RESP)"),
    ...cicsExec("READ DATASET(WS-PGM) INTO(WS-REC) RIDFLD(WS-KEY)"),
  ]));
  assert.equal(callFor(r, 'CW-CICS-INQUIRE-TRANSACTION'), "CALL 'CW-CICS-INQUIRE-TRANSACTION' USING BY REFERENCE WS-KEY WS-PGM DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-WEB-READ-HTTPHEADER'), "CALL 'CW-CICS-WEB-READ-HTTPHEADER' USING BY CONTENT WS-KEY WS-LEN BY REFERENCE WS-REC WS-RESP DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-INQUIRE-FILE'), "CALL 'CW-CICS-INQUIRE-FILE' USING BY CONTENT 'CUSTF' BY REFERENCE WS-RESP DFHEIBLK");
  assert.equal(callFor(r, 'CW-CICS-READ'), "CALL 'CW-CICS-READ' USING BY CONTENT WS-PGM BY REFERENCE WS-REC WS-KEY DFHEIBLK");
  assert.deepEqual([r.stats.unknown, r.stats.undirected], [0, 0]);
});

test('RECEIVE MAP without INTO writes the map\'s input record, and SEND MAP without FROM reads its output one', () => {
  const r = precompile(cicsProgram(CWS, [
    ...cicsExec("RECEIVE MAP('MAP1') MAPSET('SET1')"),
    ...cicsExec("SEND MAP('MAP1') MAPSET('SET1') DATAONLY"),
    ...cicsExec("SEND MAP('MAP2') MAPSET('SET1') MAPONLY"),
  ]));
  assert.equal(callFor(r, 'CW-CICS-RECEIVE-MAP'), "CALL 'CW-CICS-RECEIVE-MAP' USING BY CONTENT 'MAP1' 'SET1' BY REFERENCE MAP1I DFHEIBLK");
  assert.match(words(r.text), /CALL 'CW-CICS-SEND-MAP' USING BY CONTENT 'MAP1' 'SET1' MAP1O BY REFERENCE DFHEIBLK/);
  assert.match(words(r.text), /CALL 'CW-CICS-SEND-MAP' USING BY CONTENT 'MAP2' 'SET1' BY REFERENCE DFHEIBLK/);
});

test('DFHRESP and DFHVALUE become IBM\'s numbers in their own columns, outside a block and as an argument', () => {
  const src = cicsProgram(CWS, ['           IF WS-RESP = DFHRESP(NOTFND) OR DFHRESP(DUPREC)', '              CONTINUE', '           END-IF.',
    '           MOVE DFHVALUE(DISABLED) TO WS-RESP.', ...cicsExec("PUT CONTAINER('C1') FROM(WS-REC) DATATYPE(DFHVALUE(CHAR))")]);
  const r = precompile(src);
  const at = src.split('\n').findIndex((l) => l.includes('DFHRESP(NOTFND)'));
  assert.equal(r.text.split('\n').find((l) => l.startsWith('           IF WS-RESP')), `           IF WS-RESP = ${'13'.padEnd(15)} OR ${'14'.padEnd(15)}`);
  assert.equal(r.map[r.text.split('\n').findIndex((l) => l.startsWith('           IF WS-RESP'))], at + 1);
  assert.match(r.text, new RegExp(`MOVE ${'24'.padEnd('DFHVALUE(DISABLED)'.length)} TO WS-RESP\\.`));
  assert.equal(callFor(r, 'CW-CICS-PUT-CONTAINER'), "CALL 'CW-CICS-PUT-CONTAINER' USING BY CONTENT 'C1' WS-REC 1019 BY REFERENCE DFHEIBLK");
});

test('the EIB goes into the LINKAGE SECTION, which is added when there is none, with a DFHCOMMAREA the program names', () => {
  const uses = ['           IF EIBCALEN > 0 MOVE DFHCOMMAREA TO WS-REC END-IF.', ...cicsExec('RETURN')];
  const withLinkage = precompile(cicsProgram(CWS, uses, { linkage: ['       01 LK-AREA PIC X(10).'] }));
  const lines = withLinkage.text.split('\n');
  const at = lines.indexOf('       LINKAGE SECTION.');
  assert.deepEqual(lines.slice(at + 1, at + 3), ['       COPY DFHEIBLK.', '       01 DFHCOMMAREA PIC X.']);
  assert.equal(withLinkage.map[at + 1], withLinkage.map[at], 'an added line maps to the header it follows');
  assert.match(withLinkage.copybooks.DFHEIBLK, /05 EIBCALEN PIC S9\(4\) COMP\.\n {10}05 EIBAID PIC X\(1\)\./);
  const without = precompile(cicsProgram(CWS, cicsExec('RETURN'))).text.split('\n');
  const proc = without.indexOf('       PROCEDURE DIVISION.');
  assert.deepEqual(without.slice(proc - 2, proc), ['       LINKAGE SECTION.', '       COPY DFHEIBLK.'], 'no DFHCOMMAREA where none is named');
  const own = precompile(cicsProgram(CWS, uses, { linkage: ['       01 DFHCOMMAREA.', '          05 CA-DATA PIC X(10).'] }));
  assert.equal(own.text.match(/01 DFHCOMMAREA/g).length, 1, 'a program\'s own DFHCOMMAREA is not declared twice');
  assert.equal(precompile(program(WS, ['           EXEC SQL COMMIT END-EXEC.'])).copybooks.DFHEIBLK, undefined, 'SQL alone gets no EIB');
  if (!hasCobc) return;
  const out = accepts(withLinkage);
  assert.equal(out.status, 0, out.stderr);
});

test('HANDLE CONDITION and HANDLE AID branch through GO TO ... DEPENDING ON after their CALL, and are recorded', () => {
  const r = precompile(cicsProgram(CWS, [
    ...cicsExec('HANDLE CONDITION NOTFND(FAIL-PARA) LENGERR ERROR(FAIL-PARA)'),
    ...cicsExec('HANDLE AID PF3(FAIL-PARA)'),
    ...cicsExec('HANDLE ABEND LABEL(FAIL-PARA)'),
    ...cicsExec('IGNORE CONDITION MAPFAIL'),
  ]));
  const text = words(r.text);
  assert.match(text, /CALL 'CW-CICS-HANDLE-CONDITION' USING BY REFERENCE DFHEIBLK GO TO FAIL-PARA FAIL-PARA DEPENDING ON DFHEIGDI \./);
  assert.match(text, /CALL 'CW-CICS-HANDLE-AID' USING BY REFERENCE DFHEIBLK GO TO FAIL-PARA DEPENDING ON DFHEIGDI \./);
  assert.match(text, /CALL 'CW-CICS-HANDLE-ABEND' USING BY REFERENCE DFHEIBLK GO TO FAIL-PARA DEPENDING ON DFHEIGDI \./);
  assert.match(text, /CALL 'CW-CICS-IGNORE-CONDITION' USING BY REFERENCE DFHEIBLK \./);
  assert.deepEqual(r.handlers.map((h) => [h.command, h.options]), [
    ['HANDLE CONDITION', { NOTFND: 'FAIL-PARA', LENGERR: null, ERROR: 'FAIL-PARA' }], ['HANDLE AID', { PF3: 'FAIL-PARA' }],
    ['HANDLE ABEND', { LABEL: 'FAIL-PARA' }], ['IGNORE CONDITION', { MAPFAIL: null }]]);
  assert.match(r.copybooks.DFHEIBLK, /05 DFHEIGDI PIC S9\(4\) COMP\./);
});

test('a COPY member with EXEC CICS is translated where it is copied, and one may bring the PROCEDURE DIVISION', () => {
  const members = {
    CENTRY: ['       PROCEDURE DIVISION.', '           MOVE EIBTRNID TO WS-KEY.', ''].join('\n'),
    CRETURN: ['           EXEC CICS RETURN', '           END-EXEC.', '           IF WS-RESP = DFHRESP(NORMAL) CONTINUE END-IF.', ''].join('\n'),
  };
  const src = cicsProgram(CWS, []).replace('       PROCEDURE DIVISION.\n', '       COPY CENTRY.\n           COPY CRETURN.\n');
  const r = precompile(src, { copybook: (name) => members[name] ?? null });
  assert.match(words(r.copybooks.CRETURN), /^CALL 'CW-CICS-RETURN' USING BY REFERENCE DFHEIBLK \. IF WS-RESP = 0 CONTINUE END-IF\.$/);
  assert.equal(r.copybooks.CENTRY, undefined, 'a member with nothing to translate is left to the repository');
  assert.equal(r.stats.members, 1);
  assert.match(r.text, /LINKAGE SECTION\.\n {7}COPY DFHEIBLK\.\n {7}COPY CENTRY\./, 'the linkage goes before the COPY that opens the procedure division');
  if (!hasCobc) return;
  const out = accepts({ ...r, copybooks: { ...r.copybooks, CENTRY: members.CENTRY } });
  assert.equal(out.status, 0, out.stderr);
});

test('a literal continued onto the next line does not hide the blocks after it', () => {
  const r = precompile(cicsProgram(['       01 WS-MSG PIC X(80) VALUE \'A LONG MESSAGE THAT RUNS PAST THE END OF THE LINE AND ON',
    '      -    \'TO THE NEXT\'.', ...CWS], cicsExec('RETURN')));
  assert.equal(r.stats.translated, 1);
});

test('DFHAID, DFHBMSCA and a mapset\'s symbolic map are supplied when copied', () => {
  const mapset = parseBms(['SET1     DFHMSD TYPE=MAP,MODE=INOUT,LANG=COBOL,TIOAPFX=YES', 'MAP1     DFHMDI SIZE=(24,80)',
    'NAME     DFHMDF POS=(1,1),LENGTH=10', '         DFHMSD TYPE=FINAL', ''].join('\n')).mapsets;
  const r = precompile(cicsProgram(['       COPY DFHAID.', '       COPY DFHBMSCA.', '       COPY SET1.', ...CWS],
    ['           IF EIBAID = DFHPF3 MOVE DFHBMPRO TO NAMEA END-IF.', ...cicsExec("SEND MAP('MAP1') MAPSET('SET1')")]), { mapsets: mapset });
  assert.deepEqual(Object.keys(r.copybooks).sort(), ['DFHAID', 'DFHBMSCA', 'DFHEIBLK', 'SET1']);
  assert.match(r.copybooks.SET1, /01 {2}MAP1O REDEFINES MAP1I\./);
  if (!hasCobc) return;
  const out = accepts(r);
  assert.equal(out.status, 0, out.stderr);
});

test('cobc accepts a translated CICS program', { skip: !hasCobc && 'cobc is not installed' }, () => {
  const r = precompile(cicsProgram(['       COPY DFHAID.', ...CWS, '       01 WS-PTR POINTER.'], [
    ...cicsExec('HANDLE CONDITION NOTFND(FAIL-PARA) ERROR(FAIL-PARA)'),
    ...cicsExec("READ FILE('CUSTF') INTO(WS-REC) RIDFLD(WS-KEY) LENGTH(WS-LEN) RESP(WS-RESP)"),
    '           IF WS-RESP NOT = DFHRESP(NORMAL) GO TO FAIL-PARA END-IF.',
    ...cicsExec("STARTBR FILE('CUSTF') RIDFLD(WS-KEY)"), ...cicsExec("READPREV FILE('CUSTF') INTO(WS-REC) RIDFLD(WS-KEY)"),
    ...cicsExec("RESETBR FILE('CUSTF') RIDFLD(WS-KEY)"), ...cicsExec("ENDBR FILE('CUSTF')"),
    ...cicsExec("REWRITE FILE('CUSTF') FROM(WS-REC)"), ...cicsExec("DELETE FILE('CUSTF') RIDFLD(WS-KEY)"), ...cicsExec("UNLOCK FILE('CUSTF')"),
    ...cicsExec('LINK PROGRAM(WS-PGM) COMMAREA(WS-REC) LENGTH(80)'), ...cicsExec("LOAD PROGRAM('TABLE1') SET(WS-PTR)"),
    ...cicsExec('GETMAIN SET(WS-PTR) FLENGTH(100)'), ...cicsExec('SYNCPOINT'),
    '           IF EIBAID = DFHPF3', "              EXEC CICS XCTL PROGRAM('MENU') END-EXEC", '           END-IF.',
    ...cicsExec("RETURN TRANSID(EIBTRNID) COMMAREA(WS-REC) LENGTH(LENGTH OF WS-REC)"),
  ]));
  const out = accepts(r);
  assert.equal(out.status, 0, out.stderr);
});

test('lib/cics-commands.mjs and the tables ironwork vendors are what provenance/precompile.json generates, and every command cites IBM', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-cics-commands-'));
  const root = fileURLToPath(new URL('..', import.meta.url));
  const out = join(dir, 'cics-commands.mjs');
  const gen = spawnSync(process.execPath, [join(root, 'diag', 'generate-precompile.mjs'), join(root, 'provenance', 'precompile.json'), join(root, 'provenance', 'words.json'), out, dir], { encoding: 'utf8' });
  assert.equal(gen.status, 0, gen.stderr);
  const lf = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(lf(join(root, 'lib', 'cics-commands.mjs')), lf(out), 'regenerate lib/cics-commands.mjs');
  for (const table of ['cics-commands.tsv', 'dfhresp.tsv', 'dfhvalue.tsv']) {
    assert.equal(lf(join(root, 'provenance', table)), lf(join(dir, table)), `regenerate provenance/${table}`);
  }
  const prov = JSON.parse(readFileSync(join(root, 'provenance', 'precompile.json'), 'utf8'));
  for (const [name, c] of Object.entries(prov.commands)) {
    assert.match(c.doc || '', /^https:\/\/www\.ibm\.com\/docs\//, `${name}: no IBM documentation URL`);
    if (c.source === 'cics-api-6.x') assert.ok(prov.sources[c.source].topics.some((t) => t.url === c.doc), `${name}: its page is not among the hashed topics`);
    else assert.ok(Number.isInteger(c.page), `${name}: no page in the reference`);
    for (const [option, [argument, direction]] of Object.entries(c.options)) {
      const plain = prov.argumentTypes.directions[argument];
      if (plain !== direction) assert.ok(c.notes?.[option], `${name} ${option}: a ${argument} that ${direction} needs a note saying why`);
    }
  }
});

// ironwork vendors the table and checks its own reading of the same rows against it.
test('each statement in the shared host-variable table reads and writes what the table says', () => {
  const table = readFileSync(fileURLToPath(new URL('fixtures/sql/host-variables.tsv', import.meta.url)), 'utf8');
  const list = (cell) => (cell === '-' ? [] : cell.split(' '));
  const rows = table.split(/\r?\n/).filter((l) => l && !l.startsWith('#')).map((l) => l.split('\t'));
  assert.ok(rows.length >= 20);
  for (const [statement, read, written] of rows) {
    const { sending, receiving } = hostVariableRoles(statement);
    assert.deepEqual({ read: sending, written: receiving }, { read: list(read), written: list(written) }, statement);
  }
});

test('DFHVALUE has the CVDAs CICS TS added after 5.3, ADDRESS from 5.4, and AWARE as 6.x numbers it', async () => {
  const { DFHVALUE } = await import('../lib/cics-commands.mjs');
  assert.deepEqual([DFHVALUE.SECERROR, DFHVALUE.NODEJSAPP, DFHVALUE.ADDRESS, DFHVALUE.AWARE, DFHVALUE.NOTAWARE, DFHVALUE.VALIDATEWARN], [1214, 1215, 859, 1256, 1257, 1266]);
  assert.equal(Object.keys(DFHVALUE).length, 1061);
});
