import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readHlasmStatements, parseHlasmStatement } from '../lib/hlasm/read.mjs';
import { parseExpression, parseAddress, symbolsOf } from '../lib/hlasm/expr.mjs';
import { readDataOperand } from '../lib/hlasm/asm/data.mjs';
import { parseInstruction } from '../lib/hlasm/instr.mjs';
import { splitOperands, HlasmSyntax } from '../lib/hlasm/operands.mjs';
import './pin-machine.mjs';

const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);
const dc = (text) => readDataOperand(text, 0, { nominalRequired: true }).operand;

test('operands split at commas outside quotes and parentheses, and an attribute reference is not a quote', () => {
  assert.deepEqual(splitOperands("R1,L'FIELD(R2)"), ['R1', "L'FIELD(R2)"]);
  assert.deepEqual(splitOperands("C'A,B',(X,Y)"), ["C'A,B'", '(X,Y)']);
  assert.deepEqual(splitOperands("'TITLE - A, B'"), ["'TITLE - A, B'"]);
  assert.throws(() => splitOperands("C'ABC"), HlasmSyntax);
});

test('expressions read terms, self-defining terms, literals and attribute references with precedence', () => {
  const e = parseExpression("A+B*2-L'C");
  assert.equal(e.t, 'bin');
  assert.equal(e.op, '-');
  assert.equal(e.r.t, 'attr');
  assert.deepEqual(symbolsOf(e).sort(), ['A', 'B', 'C']);
  assert.equal(parseExpression("X'FF'").t, 'sdt');
  assert.equal(parseExpression('*-START').l.t, 'loc');
  assert.equal(parseExpression("=F'1'").dc.type, 'F');
  assert.throws(() => parseExpression('A+'), HlasmSyntax);
});

test('an address keeps its displacement and the parts in parentheses, an omitted one as null', () => {
  const a = parseAddress('0(,R1)');
  assert.equal(a.parts.length, 2);
  assert.equal(a.parts[0], null);
  assert.equal(parseAddress('FIELD+4').parts, null);
  assert.equal(parseAddress('OUT(8)').parts.length, 1);
});

test('DC operands read duplication, type, extension, modifiers and nominal value', () => {
  const c = dc("3CL8'AB''C'");
  assert.equal(c.dup.v, 3);
  assert.equal(c.type, 'C');
  assert.equal(c.length.v, 8);
  assert.equal(c.nominal.quoted, "AB'C");
  assert.equal(dc("FD'1'").ext, 'D');
  assert.equal(dc('AL3(X,Y)').nominal.expressions.length, 2);
  assert.equal(dc('S(4(R13))').nominal.expressions[0].t, 'address');
  assert.equal(dc('0F').nominal, null);
  assert.throws(() => dc('F'), HlasmSyntax);
  assert.throws(() => dc("A'1'"), HlasmSyntax);
});

test('a DC or DS statement parses each operand, and a DC with no nominal value is refused unless its duplication factor is zero', () => {
  assert.equal(parse("FIELD    DC    H'1',XL3'00',F'2',CL5'AB'").node.operands.length, 4);
  assert.equal(parse('         DS    0F').status, 'parsed');
  assert.equal(parse('         DC    0CL34').status, 'parsed');
  assert.equal(parse('         DC    CL34').status, 'unparsed');
});

test('a machine instruction matches the operand syntax of its row', () => {
  const row = { mnemonic: 'MVC', format: 'SS-a', length: 6, operands: 'D1(L1,B1),D2(B2)' };
  const st = (field) => ({ operation: 'MVC', field });
  assert.equal(parseInstruction(st('OUT(8),=C\'ABCDEFGH\''), row).operands.length, 2);
  assert.throws(() => parseInstruction(st('0(8,2),0(4,5)'), row), HlasmSyntax);
  assert.throws(() => parseInstruction(st('OUT'), row), HlasmSyntax);
  const opt = { mnemonic: 'X', format: 'RRF-c', length: 4, operands: 'R1,R2[,M3]' };
  assert.equal(parseInstruction({ operation: 'X', field: '1,2' }, opt).operands.length, 2);
  assert.equal(parseInstruction({ operation: 'X', field: '1,2,3' }, opt).operands.length, 3);
});

test('macro definitions, conditional assembly and substituted statements are counted, not read', () => {
  const { statements } = readHlasmStatements([
    '         MACRO',
    '&L       MYMAC &A',
    '&L       MVC   &A,X',
    '         MEND',
    '         AIF   (1).SKIP',
    "         DC    C'&&'",
    '&N       SETC  \'X\'',
    '&N       DS    F',
  ].join('\n'));
  const kinds = statements.map((s) => parseHlasmStatement(s).kind);
  assert.deepEqual(kinds, ['MACRO DEFINITION', 'PROTOTYPE', 'MODEL', 'MACRO DEFINITION', 'CONDITIONAL', 'DC', 'CONDITIONAL', 'SUBSTITUTED']);
  assert.equal(parseHlasmStatement(statements[4]).status, 'unbuilt');
});

test('a lone comma in the operand field of an assembler instruction is no operand', () => {
  assert.equal(parse('         EJECT ,                  NEW PAGE').status, 'parsed');
  assert.equal(parse('         EJECT NEXT PAGE').status, 'parsed');
});

test('an EXEC statement keeps the words after EXEC, blanks and continuation cards included', () => {
  const src = [`${'         EXEC SQL UPDATE DEPT SET MGRNO = :MGR WHERE'.padEnd(71)}X`, '               DEPTNO = :DEPT'].join('\n');
  const [st] = readHlasmStatements(src).statements;
  assert.equal(st.field, 'SQL UPDATE DEPT SET MGRNO = :MGR WHERE DEPTNO = :DEPT');
  assert.equal(parseHlasmStatement(st).kind, 'EXEC SQL');
});

test('an operation that is no name is unknown, and any other macro call is split into its operands', () => {
  assert.equal(parse('         LENGTH(218)').status, 'unknown');
  const r = parse("         MYMAC  A,,KEY=(X,Y),MSG='HI'");
  assert.equal(r.kind, 'MACRO CALL');
  assert.deepEqual(r.node.positional, ['A', '']);
  assert.equal(r.node.keywords.get('KEY'), '(X,Y)');
});

test('a macro the file defines overrides an instruction or library macro of the same name after its definition', () => {
  const { statements } = readHlasmStatements([
    'BEFORE   MSG   2,0(3)',
    '         MACRO',
    '&NAME    MSG   &TEXT',
    '&NAME    DC    C&TEXT',
    '         MEND',
    'NOMEM    MSG   \' NOT ENOUGH CORE\'',
    '         LINK  EP=MINE,ANY=VALUE',
  ].join('\n'));
  const parsed = statements.map(parseHlasmStatement);
  assert.equal(parsed[0].kind, 'RXY');
  assert.equal(parsed[5].kind, 'MACRO CALL');
  assert.equal(parsed[5].status, 'parsed');
  assert.equal(parsed[6].kind, 'LINK');
  assert.equal(parsed[6].status, 'unparsed');
});

test('CCW, CCW0 and CCW1 read their command code, data address, flags and count', () => {
  const [ccw, ccw1, short] = readHlasmStatements(['READCCW  CCW   X\'02\',BUFFER,X\'20\',L\'BUFFER', '         CCW1  2,BUF+8,0,80', '         CCW0  2,BUF'].join('\n')).statements;
  const r = parseHlasmStatement(ccw);
  assert.equal(r.status, 'parsed');
  assert.equal(r.node.kind, 'CCW');
  assert.equal(parseHlasmStatement(ccw1).status, 'parsed');
  assert.match(parseHlasmStatement(short).reason, /not 2 operands/);
});

test('a length attribute of the location counter or a literal opens no string before the remarks', () => {
  const [counter, literal] = readHlasmStatements(["         JNE   *+L'*+10            WELL, IT'S NOT THIS DSCB", "         LA    1,L'=F'1'           IT'S ONE"].join('\n')).statements;
  assert.equal(counter.field, "*+L'*+10");
  assert.equal(parseHlasmStatement(counter).status, 'parsed');
  assert.equal(literal.field, "1,L'=F'1'");
});

test("a repository's own macro overrides a macro the reader knows by name, never an instruction", () => {
  const src = ['         IF    (CLI,FLAG,EQ,C\'Y\'),THEN', '         LINK  EP=PROGA', '         MSG   2,0(3)'].join('\n');
  const [own, link, msg] = readHlasmStatements(src, { libraryMacros: new Set(['IF', 'MSG']) }).statements.map(parseHlasmStatement);
  assert.equal(own.kind, 'MACRO CALL');
  assert.equal(own.node.library, true);
  assert.equal(link.kind, 'LINK');
  assert.equal(msg.kind, 'RXY');
  assert.notEqual(parseHlasmStatement(readHlasmStatements(src).statements[0]).kind, 'MACRO CALL');
});

test('a line after a statement or comment that runs into column 72 is refused, as the assembler reads it as part of that one', () => {
  const comment = '* Perform complex calculation (For example: ((Base + Interest) * (1-Tax)) rounded special way)';
  const remark = "         MVI   12(13),X'FF'            *ML purpose of this? - can we remove it?";
  const [zap, , , sr] = readHlasmStatements([comment, '         ZAP   WORKFLD1,BASEAMT    COPY BASE', '         LR    1,2', remark, '         SR    15,15'].join('\n')).statements;
  assert.match(parseHlasmStatement(zap).reason, /comment above runs into column 72/);
  assert.match(parseHlasmStatement(sr).reason, /does not leave columns 1 to 15 blank/);
  assert.equal(parseHlasmStatement(readHlasmStatements('         LR    1,2').statements[0]).status, 'parsed');
});

test('an explicit length larger than its length field holds is refused', () => {
  const parse = (src) => parseHlasmStatement(readHlasmStatements(src).statements[0]);
  assert.match(parse('         UNPK  HEXWORK(33),HEXIN(17)').reason, /length 33, and L1 holds 0 to 16/);
  assert.equal(parse('         UNPK  HEXWORK(16),HEXIN(8)').status, 'parsed');
  assert.match(parse('         MVC   0(257,R1),FIELD').reason, /L holds 0 to 256/);
  assert.equal(parse("         MVC   0(X'100',R1),FIELD").status, 'parsed');
  assert.equal(parse('         MVC   0(LEN,R1),FIELD').status, 'parsed');
});

test('an unnamed DSECT is read, and an attribute reference split across a continuation keeps the remarks out', () => {
  assert.equal(parseHlasmStatement(readHlasmStatements('         DSECT').statements[0]).status, 'parsed');
  const card = (text, more = false) => (more ? `${text.padEnd(71)}+` : text);
  const first = "         MVC   UCB_List_Ent_UCB-UCB_List_Ent(L'UCB_List_Ent_UCB,R4),=(L";
  assert.equal(first.length, 71);
  const src = [card(first, true), card("               'UCB_List_Ent_UCB)C'*'   Initialize field")].join('\n');
  const [st] = readHlasmStatements(src).statements;
  assert.equal(st.field, "UCB_List_Ent_UCB-UCB_List_Ent(L'UCB_List_Ent_UCB,R4),=(L'UCB_List_Ent_UCB)C'*'");
  assert.equal(parseHlasmStatement(st).status, 'parsed');
});
