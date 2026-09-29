import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scan } from '../lib/sets/flow.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const root = mkdtempSync(join(tmpdir(), 'cw-nlog-'));
  for (const [name, text] of Object.entries(files)) {
    const p = join(root, name);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, typeof text === 'string' ? text : JSON.stringify(text));
  }
  return root;
};
// Fixed format: code ends at column 72, and a fixture line past it would lose its tail.
const cobol = (lines) => lines.map((l) => { if (l.length > 65) throw new Error(`past column 72: ${l}`); return `       ${l}`; }).join('\n') + '\n';
const program = (ws, body) => cobol([
  'IDENTIFICATION DIVISION.', 'PROGRAM-ID. LOGP.', 'DATA DIVISION.', 'WORKING-STORAGE SECTION.',
  '01 WS-IN PIC X(40).', '01 WS-OUT PIC X(80).', '01 WS-RESP PIC S9(8) COMP.', '01 WS-CODE PIC 9(8).', ...ws,
  'PROCEDURE DIVISION.', ...body, '    GOBACK.']);
const RECEIVE = '    EXEC CICS RECEIVE INTO(WS-IN) END-EXEC.';
const rules = (r, re) => r.findings.filter((f) => re.test(f.rule));
const logs = (r) => rules(r, /-to-log$/);

// A log line is a record; whoever prints or converts it breaks lines where the data says to.
test('terminal input written to a log unchecked is reported at every kind of log', () => {
  const cases = [
    [['    DISPLAY WS-IN.'], /reaches DISPLAY WS-IN$/],
    [['    DISPLAY WS-IN UPON CONSOLE.'], /reaches DISPLAY WS-IN UPON CONSOLE$/],
    [["    EXEC CICS WRITEQ TD QUEUE('CSMT') FROM(WS-IN)", '        END-EXEC.'], /reaches EXEC CICS WRITEQ TD QUEUE\('CSMT'\)$/],
    [['    EXEC CICS WRITE OPERATOR TEXT(WS-IN) END-EXEC.'], /reaches EXEC CICS WRITE OPERATOR TEXT\(WS-IN\), to the operator console$/],
    [["    EXEC CICS WRITE JOURNALNAME('AUDIT') JTYPEID('LG')", '        FROM(WS-IN) END-EXEC.'], /reaches EXEC CICS WRITE JOURNALNAME FROM\(WS-IN\), to a journal$/],
  ];
  for (const [body, detail] of cases) {
    const [f] = logs(scan(tree({ 'LOGP.cbl': program([], [RECEIVE, ...body]) })));
    assert.ok(f, body[0]);
    assert.equal(f.rule, 'cics-terminal-to-log');
    assert.equal(f.sev, 'low');
    assert.equal(f.cwe, 'CWE-117');
    assert.match(f.detail, detail);
  }
});

test('a check that leaves the field letters or digits stops the route: no control character gets through', () => {
  const r = scan(tree({ 'LOGP.cbl': program([], [RECEIVE, '    IF WS-IN IS NOT ALPHABETIC', '        EXEC CICS RETURN END-EXEC', '    END-IF.', '    DISPLAY WS-IN.']) }));
  assert.equal(logs(r).length, 0);
  assert.equal(r.checked.filter((c) => c.rule === 'cics-terminal-to-log').length, 1);
});

test('a queue that starts a transaction, or that feeds the internal reader, is not a log', () => {
  const write = [RECEIVE, "    EXEC CICS WRITEQ TD QUEUE('TRIG') FROM(WS-IN)", '        END-EXEC.'];
  const ati = scan(tree({ 'LOGP.cbl': program([], write), 'region.csd': 'DEFINE TDQUEUE(TRIG) GROUP(G) TYPE(INTRA) TRIGGERLEVEL(1) TRANSID(TRGT)\n' }));
  assert.equal(logs(ati).length, 0);
  const reader = scan(tree({ 'LOGP.cbl': program([], write), 'cobolwork.site.json': { internalReaderQueues: ['TRIG'] } }));
  assert.equal(logs(reader).length, 0);
  assert.equal(rules(reader, /-to-internal-reader$/).length, 1, 'the stronger claim is made instead');
});

test('a batch job logging its own PARM or command line is not reported: the submitter writes that log already', () => {
  const r = scan(tree({ 'LOGP.cbl': program([], ['    ACCEPT WS-IN FROM COMMAND-LINE.', '    DISPLAY WS-IN.']) }));
  assert.equal(logs(r).length, 0);
});

// What the system says about a failure, handed to a web client.
const WEB = ['    EXEC CICS WEB SEND FROM(WS-OUT) END-EXEC.'];
const leaks = (r) => rules(r, /^system-response-to-/);

test('a response code or SQL error the system set, sent in a web response, is reported', () => {
  const cases = [
    [["    EXEC CICS READ FILE('ACCTS') INTO(WS-IN)", '        RIDFLD(WS-CODE) RESP(WS-RESP) END-EXEC.', '    MOVE WS-RESP TO WS-CODE.', '    MOVE WS-CODE TO WS-OUT.'], /the RESP of EXEC CICS READ at LOGP\.cbl:\d+ reaches EXEC CICS WEB SEND/],
    [['    MOVE EIBRESP TO WS-CODE.', '    MOVE WS-CODE TO WS-OUT.'], /EIBRESP, which the system sets at LOGP\.cbl:\d+ reaches/],
    [['    MOVE SQLCODE TO WS-CODE.', "    STRING 'SQL ERROR ' WS-CODE DELIMITED BY SIZE", '        INTO WS-OUT.'], /SQLCODE, which the system sets at LOGP\.cbl:\d+ reaches/],
  ];
  for (const [body, detail] of cases) {
    const [f] = leaks(scan(tree({ 'LOGP.cbl': program([], [...body, ...WEB]) })));
    assert.ok(f, body[0]);
    assert.equal(f.rule, 'system-response-to-web-response');
    assert.equal(f.sev, 'low');
    assert.equal(f.cwe, 'CWE-209');
    assert.match(f.detail, detail);
  }
});

test('a response code the program only tests, or only logs, is not a leak', () => {
  const tested = scan(tree({ 'LOGP.cbl': program([], ['    IF EIBRESP NOT = 0', "        MOVE 'REQUEST FAILED' TO WS-OUT", '    END-IF.', ...WEB]) }));
  assert.equal(leaks(tested).length, 0, 'the program chose the message');
  const logged = scan(tree({ 'LOGP.cbl': program([], ['    MOVE EIBRESP TO WS-CODE.', '    DISPLAY WS-CODE.']) }));
  assert.deepEqual(logged.findings.map((f) => f.rule), [], 'a response code in its own log is the program\'s business');
  const routed = scan(tree({ 'LOGP.cbl': program(['01 WS-PGM PIC X(8).'], ['    MOVE EIBRESP TO WS-PGM.', '    EXEC CICS XCTL PROGRAM(WS-PGM) END-EXEC.']) }));
  assert.deepEqual(leaks(routed), [], 'it reaches only a response, whatever else it touches');
});

test('no check lowers a leak: a numeric response code is still the system\'s', () => {
  const r = scan(tree({ 'LOGP.cbl': program([], ['    MOVE EIBRESP TO WS-CODE.', '    IF WS-CODE IS NOT NUMERIC', '        EXEC CICS RETURN END-EXEC', '    END-IF.', '    MOVE WS-CODE TO WS-OUT.', ...WEB]) }));
  const [f] = leaks(r);
  assert.equal(f.sev, 'low');
  assert.equal(f.guardedFrom, undefined);
  assert.equal(r.checked.filter((c) => /^system-response-to-/.test(c.rule)).length, 0);
});

// UPON names where a DISPLAY goes. A field of the same name, however tainted, is not what it writes.
test('what follows UPON is where the value went, not a value written', () => {
  const r = scan(tree({ 'LOGP.cbl': program([], [RECEIVE, "    DISPLAY 'ALERT' UPON WS-IN."]) }));
  assert.deepEqual(logs(r), []);
});
