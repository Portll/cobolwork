import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPliExpanded, membersOf, chooseMember } from '../lib/pli/include.mjs';
import { parseStatement } from '../lib/pli/statements.mjs';
import './pin-machine.mjs';

const tree = (files) => {
  const members = membersOf(Object.keys(files));
  return (name, from) => { const path = chooseMember(members.get(name), from); return path ? { path, text: files[path] } : null; };
};

test('a member holding the rest of a DECLARE is spliced in before statements are split', () => {
  const read = tree({ 'src/MAIN.pli': '', 'cpy/RECFLDS.inc': '   2 A CHAR(4),\n   2 B FIXED BIN(31);\n' });
  const r = readPliExpanded(' DCL 1 REC,\n %INCLUDE RECFLDS;\n X = 1;', { file: 'src/MAIN.pli', readMember: read });
  const [dcl, asg] = r.statements;
  const p = parseStatement(dcl);
  assert.equal(p.status, 'parsed');
  assert.deepEqual(p.node.items.map((i) => i.name), ['REC', 'A', 'B']);
  assert.deepEqual([dcl.toks.at(-1).file, dcl.toks.at(-1).line], ['cpy/RECFLDS.inc', 2]);
  assert.equal(asg.file, 'src/MAIN.pli');
  assert.deepEqual(r.included.map((x) => x.name), ['RECFLDS']);
});

test('members nest, and each directive form names its member', () => {
  const read = tree({ 'A.inc': " %INCLUDE SYSLIB(B);\n DCL A1 CHAR(1);", 'B.inc': " %INCLUDE 'c';", 'C.inc': ' DCL C1 CHAR(1);' });
  const r = readPliExpanded(' %INCLUDE A;', { file: 'M.pli', readMember: read });
  assert.deepEqual(r.statements.map((s) => s.toks.map((t) => t.v).join(' ')), ['DCL C1 CHAR ( 1 )', 'DCL A1 CHAR ( 1 )']);
});

test('XINCLUDE takes a member once; INCLUDE every time', () => {
  const read = tree({ 'D.inc': ' X = X + 1;' });
  assert.equal(readPliExpanded(' %XINCLUDE D; %XINCLUDE D;', { file: 'M.pli', readMember: read }).statements.length, 1);
  assert.equal(readPliExpanded(' %INCLUDE D; %INCLUDE D;', { file: 'M.pli', readMember: read }).statements.length, 2);
});

test('an unresolved member keeps its directive and is named; a cycle is cut and named', () => {
  const read = tree({ 'E.inc': ' %INCLUDE F;', 'F.inc': ' %INCLUDE E;' });
  const u = readPliExpanded(' %INCLUDE NOSUCH;', { file: 'M.pli', readMember: read });
  assert.deepEqual([u.statements.length, u.unresolved.map((x) => x.name)], [1, ['NOSUCH']]);
  const c = readPliExpanded(' %INCLUDE E;', { file: 'M.pli', readMember: read });
  assert.deepEqual(c.cycles.map((x) => x.chain.join('>')), ['E>F>E']);
});

test('a member in the including file\'s own directory is preferred', () => {
  assert.equal(chooseMember(['lib/X.inc', 'src/X.inc'], 'src/M.pli'), 'src/X.inc');
  assert.equal(chooseMember(['lib/X.inc', 'other/X.inc'], 'src/M.pli'), 'lib/X.inc');
});
