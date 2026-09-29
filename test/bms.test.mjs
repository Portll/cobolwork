import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { foldStatements, parseBms, symbolicNames, symbolIndex } from '../lib/bms.mjs';
import { splitOperands } from '../lib/jcl.mjs';
import { parseSource } from '../lib/parser.mjs';
import { isBms, isJcl, isProgram, isSource, sniffKind } from '../lib/sources.mjs';
import './pin-machine.mjs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'bms');
const fixture = (f) => readFileSync(join(FIXTURES, f), 'latin1');

// A line of a map: `text` in columns 1 to 71, then column 72 (a continuation mark when `more`),
// then whatever sits in the sequence field.
const ln = (text, more = false, seq = '') => {
  assert.ok(text.length <= 71, `longer than column 71: ${text}`);
  return more || seq ? text.padEnd(71) + (more ? 'X' : ' ') + seq : text;
};

// A statement in the assembler's standard format: operands run to column 71 and carry on in column
// 16, split wherever column 71 falls, inside a literal or not.
function packed(name, op, operands) {
  let rest = `${(name || '').padEnd(8)} ${op} ${operands}`.trimEnd();
  const lines = [rest.slice(0, 71)];
  for (rest = rest.slice(71); rest; rest = rest.slice(56)) lines.push(' '.repeat(15) + rest.slice(0, 56));
  return lines.map((l, i) => (i < lines.length - 1 ? l.padEnd(71) + 'X' : l)).join('\n');
}

// One operand to a line, each ending in a comma and a blank, the way CardDemo writes its maps; an
// operand too long for its line carries on in column 16.
function perLine(name, op, operands) {
  const parts = splitOperands(operands).filter(Boolean);
  const out = [];
  let prefix = `${(name || '').padEnd(8)} ${op} `;
  parts.forEach((part, k) => {
    const last = k === parts.length - 1;
    let text = prefix + part + (last ? '' : ',');
    for (; text.length > 71; text = ' '.repeat(15) + text.slice(71)) out.push(text.slice(0, 71) + 'X');
    out.push(last ? text : text.padEnd(71) + 'X');
    prefix = ' '.repeat(15);
  });
  if (!parts.length) out.push(prefix.trimEnd());
  return out.join('\n');
}

const relayout = (src, lay) => foldStatements(src).statements
  .filter((s) => s.kind === 'statement')
  .map((s) => lay(s.name, s.operation, s.field))
  .join('\n');

// What a parse says about the maps, without where in the file it said it.
const shape = (bms) => bms.mapsets.map(({ line, endLine, lines, finalLine, maps, ...ms }) => ({
  ...ms,
  maps: maps.map(({ line: l, endLine: e, lines: ls, fields, ...m }) => ({
    ...m,
    fields: fields.map(({ line: fl, endLine: fe, lines: fls, ...f }) => f),
  })),
}));

// The names in each record of a generated copybook, as the COBOL parser reads them when a program
// copies it: what the dataflow side starts from.
function copybookRecords(member) {
  const src = ['       IDENTIFICATION DIVISION.', '       PROGRAM-ID. JOIN.', '       DATA DIVISION.',
    '       WORKING-STORAGE SECTION.', `       COPY ${member}.`, '       PROCEDURE DIVISION.', '           GOBACK.', ''].join('\n');
  const r = parseSource(src, join(FIXTURES, 'JOIN.cbl'), { format: 'auto', mainDir: FIXTURES });
  assert.deepEqual(r.copies.map((c) => c.status), ['resolved']);
  const records = new Map();
  for (const item of r.programs[0].items) {
    let root = item;
    while (root.parent) root = root.parent;
    if (root === item) records.set(item.name, []);
    else if (item.name !== 'FILLER') records.get(root.name).push(item.name);
  }
  return records;
}

function generatedRecords(bms) {
  const records = new Map();
  for (const ms of bms.mapsets) for (const map of ms.maps) {
    for (const r of [map.symbolic.input, map.symbolic.output]) if (r) records.set(r, []);
    for (const f of map.fields) for (const n of symbolicNames(map, f)) records.get(n.record).push(n.name);
  }
  return records;
}

const fieldOf = (bms, name) => bms.mapsets.flatMap((ms) => ms.maps).flatMap((m) => m.fields).find((f) => f.name === name);
const mapOf = (bms, name) => bms.mapsets.flatMap((ms) => ms.maps).find((m) => m.name === name);

test('both continuation forms fold, a literal carries on in column 16, and the sequence field is ignored', () => {
  const src = [
    ln('* A map written both ways the assembler allows.'),
    ln('SET1     DFHMSD TYPE=&&SYSPARM,MODE=INOUT,   a remark after the blank', true, '00010000'),
    ln('               LANG=COBOL,STORAGE=AUTO,TIOAPFX=YES', false, '00020000'),
    ln('MAP1     DFHMDI SIZE=(24,80),LINE=1,COLUMN=1'),
    packed('TITLE', 'DFHMDF', "POS=(1,1),LENGTH=66,ATTRB=(ASKIP,BRT),INITIAL='Pay, don''t delay: a literal long enough to run past column 71'"),
    ln('         DFHMSD TYPE=FINAL'),
    ln('         END'),
    ln('JUNK     DFHMDF POS=(9,9)'),
  ].join('\n');
  const { statements, diags } = foldStatements(src);
  const set = statements.find((s) => s.operation === 'DFHMSD');
  assert.equal(set.field, 'TYPE=&&SYSPARM,MODE=INOUT,LANG=COBOL,STORAGE=AUTO,TIOAPFX=YES', 'the remark and the sequence numbers are not operands');
  assert.deepEqual(set.lines, [2, 3]);
  const title = statements.find((s) => s.name === 'TITLE');
  assert.ok(title.lines.length > 1, 'the literal was split across lines');
  assert.deepEqual(diags, []);

  const bms = parseBms(src);
  assert.equal(fieldOf(bms, 'TITLE').initial, "Pay, don't delay: a literal long enough to run past column 71",
    'split mid-literal, and a doubled quote begins the continuation');
  assert.equal(fieldOf(bms, 'JUNK'), undefined, 'the assembler reads nothing after END');
});

test('an operand after a comma and a blank, or starting past column 16, is a remark and is reported', () => {
  const src = [
    ln('SET1     DFHMSD TYPE=DSECT,MODE=INOUT,LANG=COBOL'),
    ln('MAP1     DFHMDI SIZE=(24,80)'),
    ln('SHOWN    DFHMDF POS=(3,1),LENGTH=9, ATTRB=(UNPROT),', true),
    ln("               INITIAL='x'"),
    ln('LATE     DFHMDF POS=(4,1),LENGTH=4,', true),
    ln('                  ATTRB=(UNPROT)'),
    ln('         DFHMSD TYPE=FINAL'),
  ].join('\n');
  const bms = parseBms(src);
  const shown = fieldOf(bms, 'SHOWN');
  assert.equal(shown.attrb, null, 'what looks like ATTRB=(UNPROT) never reaches the macro');
  assert.deepEqual(shown.effective, new Set(['ASKIP', 'NORM']));
  assert.equal(shown.initial, 'x', 'the operand on the next line still is one');
  assert.equal(fieldOf(bms, 'LATE').attrb, null);
  assert.deepEqual(bms.diags.map((d) => [d.sev, d.line, d.text]), [
    ['warn', 3, "'ATTRB=(UNPROT),' follows a comma and a blank, so the assembler reads it as a remark, not an operand"],
    ['warn', 6, "'ATTRB=(UNPROT)' does not start in column 16, so the assembler reads it as a remark, not an operand"],
  ]);
});

test('a continuation that does not leave columns 1 to 15 blank is a new statement, and an open literal is reported', () => {
  const src = [
    ln('SET1     DFHMSD TYPE=DSECT,LANG=COBOL'),
    ln('MAP1     DFHMDI SIZE=(24,80)'),
    ln('A        DFHMDF POS=(1,1),LENGTH=4,', true),
    ln('B        DFHMDF POS=(2,1),LENGTH=4'),
    ln("C        DFHMDF POS=(3,1),LENGTH=4,INITIAL='open"),
    ln('         DFHMSD TYPE=FINAL'),
  ].join('\n');
  const bms = parseBms(src);
  assert.deepEqual(bms.mapsets[0].maps[0].fields.map((f) => f.name), ['A', 'B', 'C'], 'B is not swallowed into A');
  assert.deepEqual(bms.diags.map((d) => [d.sev, d.line]), [['error', 4], ['error', 5]]);
});

test('operands keep their commas and doubled quotes, and POS reads either way it is written', () => {
  const src = [
    ln('SET1     DFHMSD TYPE=MAP,MODE=INOUT,LANG=COBOL'),
    ln('MAP1     DFHMDI SIZE=(24,80)'),
    ln("LIT      DFHMDF POS=(2,5),LENGTH=12,INITIAL='A, B ''C'' && D'"),
    ln('OFF      DFHMDF POS=161,LENGTH=5,PICIN=\'9(5)\',PICOUT=\'ZZZZ9\''),
    ln('         DFHMSD TYPE=FINAL'),
    ln('SET2     DFHMSD TYPE=MAP'),
    ln('MAP2     DFHMDI LINE=NEXT'),
    ln('LOOSE    DFHMDF POS=161,LENGTH=5'),
    ln('         DFHMSD TYPE=FINAL'),
  ].join('\n');
  const bms = parseBms(src);
  const lit = fieldOf(bms, 'LIT');
  assert.equal(lit.initial, "A, B 'C' & D");
  assert.equal(lit.operands.get('INITIAL'), "'A, B ''C'' && D'", 'the operand as written is kept too');
  assert.deepEqual(lit.pos, { line: 2, column: 5 });
  assert.equal(lit.length, 12);
  assert.equal(lit.line, 3);
  const off = fieldOf(bms, 'OFF');
  assert.deepEqual(off.pos, { line: 3, column: 2, offset: 161 }, 'an offset counts from zero across 80 columns');
  assert.equal(off.picin, '9(5)');
  assert.equal(off.picout, 'ZZZZ9');
  assert.deepEqual(fieldOf(bms, 'LOOSE').pos, { line: null, column: null, offset: 161 });
  assert.deepEqual(bms.diags.map((d) => d.line), [8], 'without SIZE an offset has no line or column, and says so');
  assert.equal(mapOf(bms, 'MAP2').options.line, 'NEXT');
});

test('ATTRB is kept as declared, and effective applies the defaults IBM gives', () => {
  const src = [
    ln('SET1     DFHMSD TYPE=DSECT,MODE=INOUT,LANG=COBOL'),
    ln('MAP1     DFHMDI SIZE=(24,80)'),
    ln('NONE     DFHMDF POS=(1,1),LENGTH=4'),
    ln('BRIGHT   DFHMDF POS=(2,1),LENGTH=4,ATTRB=BRT'),
    ln('DIGITS   DFHMDF POS=(3,1),LENGTH=4,ATTRB=(NORM,NUM,IC)'),
    ln('SHUT     DFHMDF POS=(4,1),LENGTH=4,ATTRB=(PROT)'),
    ln('HIDDEN   DFHMDF POS=(5,1),LENGTH=4,ATTRB=(ASKIP,DRK,FSET)'),
    ln('ODD      DFHMDF POS=(6,1),LENGTH=4,ATTRB=(PORT)'),
    ln('         DFHMSD TYPE=FINAL'),
  ].join('\n');
  const bms = parseBms(src);
  const attrs = (name) => [fieldOf(bms, name).attrb && [...fieldOf(bms, name).attrb].sort(), [...fieldOf(bms, name).effective].sort()];
  assert.deepEqual(attrs('NONE'), [null, ['ASKIP', 'NORM']], 'no ATTRB: autoskip');
  assert.deepEqual(attrs('BRIGHT'), [['BRT'], ['BRT', 'UNPROT']], 'any ATTRB at all: unprotected unless it says otherwise');
  assert.deepEqual(attrs('DIGITS'), [['IC', 'NORM', 'NUM'], ['IC', 'NORM', 'NUM', 'UNPROT']], 'NUM is a keyboard shift on an input field');
  assert.deepEqual(attrs('SHUT'), [['PROT'], ['NORM', 'PROT']]);
  assert.deepEqual(attrs('HIDDEN'), [['ASKIP', 'DRK', 'FSET'], ['ASKIP', 'DRK', 'FSET']], 'nothing folded into a boolean');
  assert.deepEqual(attrs('ODD'), [['PORT'], ['NORM', 'PORT', 'UNPROT']], 'an unknown keyword is kept');
  assert.deepEqual(bms.diags.map((d) => d.text), ["ATTRB keyword 'PORT' is not one BMS defines"]);
});

test('a field with no label is kept, has no names, and cannot pass for a data field', () => {
  const bms = parseBms(fixture('COSGN00.bms'));
  const map = mapOf(bms, 'COSGN0A');
  const unnamed = map.fields.filter((f) => f.name === null);
  assert.equal(map.fields.length, 37);
  assert.equal(unnamed.length, 26);
  for (const f of unnamed) assert.deepEqual(symbolicNames(map, f), []);
  const caption = unnamed.find((f) => f.initial === 'Type your User ID and Password, then press ENTER:');
  assert.deepEqual(caption.pos, { line: 17, column: 16 }, 'a caption continued mid-word in column 16 reads whole');
  const stopper = unnamed.find((f) => f.pos.line === 20 && f.pos.column === 61);
  assert.deepEqual(stopper.effective, new Set(['DRK', 'UNPROT']), 'an unlabelled field can be enterable and still carry no data');
});

test('the mapset and map options are read, and TYPE is kept as written', () => {
  const sgn = parseBms(fixture('COSGN00.bms'));
  assert.deepEqual(sgn.diags, []);
  const ms = sgn.mapsets[0];
  assert.equal(ms.name, 'COSGN00');
  assert.deepEqual(
    [ms.options.type, ms.options.mode, ms.options.lang, ms.options.suffix, ms.options.storage, ms.options.extatt],
    ['&&SYSPARM', 'INOUT', 'COBOL', null, 'AUTO', 'YES'],
  );
  assert.equal(ms.finalLine, 209);
  const map = ms.maps[0];
  assert.equal(map.name, 'COSGN0A');
  assert.deepEqual([map.options.size, map.options.line, map.options.column, map.options.fields], [{ lines: 24, columns: 80 }, 1, 1, null]);

  const sel = parseBms(fixture('COCRDSL.bms'));
  assert.deepEqual(sel.diags, [], 'TITLE is an assembler instruction, not an unknown statement');
  const ccrd = mapOf(sel, 'CCRDSLA');
  assert.deepEqual(ccrd.options.dsatts, ['COLOR', 'HILIGHT', 'PS', 'VALIDN']);
  assert.deepEqual([ccrd.options.line, ccrd.options.column], [null, null], 'not given, so not invented');
  assert.deepEqual(ccrd.symbolic.attributes, ['COLOR', 'PS', 'HILIGHT', 'VALIDN'], 'in the order the generator lays them out');

  const nul = parseBms([ln('SET1     DFHMSD TYPE=MAP,SUFFIX=9'), ln('HOLE     DFHMDI SIZE=(2,80),FIELDS=NO'), ln('         DFHMSD TYPE=FINAL')].join('\n'));
  assert.equal(nul.mapsets[0].options.suffix, '9');
  assert.equal(mapOf(nul, 'HOLE').options.fields, 'NO');
});

// The strongest check there is: CardDemo ships the copybooks CICS generated from its maps, so each
// generated name can be compared with the one CICS produced, record by record and in order.
test('the names generated for CardDemo maps are the names in the copybooks CICS generated from them', () => {
  for (const member of ['COSGN00', 'COCRDSL']) {
    const bms = parseBms(fixture(`${member}.bms`));
    assert.deepEqual(generatedRecords(bms), copybookRecords(member), member);
  }
  const sel = parseBms(fixture('COCRDSL.bms'));
  const names = symbolicNames(mapOf(sel, 'CCRDSLA'), fieldOf(sel, 'ACCTSID')).map((n) => `${n.record}.${n.name}`);
  assert.deepEqual(names, ['CCRDSLAI.ACCTSIDL', 'CCRDSLAI.ACCTSIDF', 'CCRDSLAI.ACCTSIDA', 'CCRDSLAI.ACCTSIDI',
    'CCRDSLAO.ACCTSIDC', 'CCRDSLAO.ACCTSIDP', 'CCRDSLAO.ACCTSIDH', 'CCRDSLAO.ACCTSIDV', 'CCRDSLAO.ACCTSIDO']);
});

test('a COBOL name leads back to its map field: the names CardDemo sign-on program uses', () => {
  const sgn = parseBms(fixture('COSGN00.bms'));
  const index = symbolIndex(sgn, parseBms(fixture('COCRDSL.bms')));
  // As COSGN00C writes them: USERIDI OF COSGN0AI, ERRMSGO OF COSGN0AO, and so on.
  const uses = [['USERIDI', 'COSGN0AI', 'USERID', 'I'], ['USERIDL', 'COSGN0AI', 'USERID', 'L'],
    ['PASSWDI', 'COSGN0AI', 'PASSWD', 'I'], ['PASSWDL', 'COSGN0AI', 'PASSWD', 'L'], ['ERRMSGO', 'COSGN0AO', 'ERRMSG', 'O'],
    ['TITLE01O', 'COSGN0AO', 'TITLE01', 'O'], ['TRNNAMEO', 'COSGN0AO', 'TRNNAME', 'O'], ['PGMNAMEO', 'COSGN0AO', 'PGMNAME', 'O'],
    ['CURDATEO', 'COSGN0AO', 'CURDATE', 'O'], ['CURTIMEO', 'COSGN0AO', 'CURTIME', 'O'], ['APPLIDO', 'COSGN0AO', 'APPLID', 'O'],
    ['SYSIDO', 'COSGN0AO', 'SYSID', 'O']];
  for (const [name, record, field, suffix] of uses) {
    assert.deepEqual(index.get(name).filter((h) => h.record === record), [{ mapset: 'COSGN00', map: 'COSGN0A', field, suffix, record }], name);
  }
  assert.deepEqual(index.get('COSGN0AO'), [{ mapset: 'COSGN00', map: 'COSGN0A', field: null, suffix: 'O', record: 'COSGN0AO' }]);
  assert.deepEqual(index.get('TRNNAMEI').map((h) => h.record), ['COSGN0AI', 'CCRDSLAI'], 'one name, two maps, told apart by record');
  assert.equal(index.get('WS-USER-ID'), undefined);
  assert.deepEqual(fieldOf(sgn, 'PASSWD').effective, new Set(['DRK', 'FSET', 'UNPROT']));
  assert.deepEqual(fieldOf(sgn, 'PGMNAME').effective, new Set(['FSET', 'NORM', 'PROT']), 'protected, and sent back on every read');

  // Every name a field generates leads back to that field.
  for (const map of sgn.mapsets[0].maps) for (const f of map.fields) for (const n of symbolicNames(map, f)) {
    assert.ok(index.get(n.name).some((h) => h.field === f.name && h.suffix === n.suffix && h.record === n.record), n.name);
  }
});

// No copybook in this repository shows an array, so the expected names mirror one CICS TS 6.2
// generated for a map of this shape: an input array NAMED of L, F and I, an output array DFHMSn of A,
// the extended attributes and O, and no A on the input side.
test('an OCCURS field is an array on each side, named as CICS generates it', () => {
  const src = [
    ln('LIST     DFHMSD TYPE=DSECT,MODE=INOUT,LANG=COBOL,STORAGE=AUTO,', true),
    ln('               TIOAPFX=YES,DSATTS=COLOR,MAPATTS=(COLOR,HILIGHT)'),
    ln('HEAD     DFHMDI SIZE=(24,80)'),
    ln('TRAN     DFHMDF POS=(1,1),LENGTH=4,ATTRB=(ASKIP,NORM)'),
    ln('FILT     DFHMDI SIZE=(24,80)'),
    ln('MATCH    DFHMDF POS=(3,45),LENGTH=30,ATTRB=(UNPROT,BRT)'),
    ln('PICK     DFHMDF POS=(8,34),LENGTH=8,ATTRB=(UNPROT,BRT),OCCURS=4'),
    ln('SKIP     DFHMDF POS=(9,34),LENGTH=8,ATTRB=(UNPROT,BRT),OCCURS=4'),
    ln('         DFHMSD TYPE=FINAL'),
  ].join('\n');
  const bms = parseBms(src);
  assert.deepEqual(generatedRecords(bms), new Map([
    ['HEADI', ['TRANL', 'TRANF', 'TRANA', 'TRANI']],
    ['HEADO', ['TRANC', 'TRANO']],
    ['FILTI', ['MATCHL', 'MATCHF', 'MATCHA', 'MATCHI', 'PICKD', 'PICKL', 'PICKF', 'PICKI', 'SKIPD', 'SKIPL', 'SKIPF', 'SKIPI']],
    ['FILTO', ['MATCHC', 'MATCHO', 'DFHMS1', 'PICKA', 'PICKC', 'PICKO', 'DFHMS2', 'SKIPA', 'SKIPC', 'SKIPO']],
  ]));
  const index = symbolIndex(bms);
  assert.deepEqual(index.get('PICKI'), [{ mapset: 'LIST', map: 'FILT', field: 'PICK', suffix: 'I', record: 'FILTI', occurs: 4 }]);
  assert.deepEqual(index.get('DFHMS2'), [{ mapset: 'LIST', map: 'FILT', field: 'SKIP', suffix: null, record: 'FILTO', occurs: 4 }]);
});

// IBM's example of a group, written with MODE left at its default of OUT. IBM prints the separator
// as SEP1 and the day as DAO, with no O on the first; the generator adds O to every field, so
// SEP1O and DAYO are expected here.
test('a GRPNAME group shares one attribute byte, and its first field\'s ATTRB applies to all of it', () => {
  const src = [
    ln('DATEMS   DFHMSD TYPE=DSECT,LANG=COBOL'),
    ln('DATEM    DFHMDI SIZE=(24,80)'),
    ln('MO       DFHMDF POS=(10,1),LENGTH=2,ATTRB=BRT,GRPNAME=DATE'),
    ln("SEP1     DFHMDF POS=(10,3),LENGTH=1,GRPNAME=DATE,INITIAL='-'"),
    ln('DAY      DFHMDF POS=(10,4),LENGTH=2,GRPNAME=DATE'),
    ln("SEP2     DFHMDF POS=(10,6),LENGTH=1,GRPNAME=DATE,INITIAL='-'"),
    ln('YR       DFHMDF POS=(10,7),LENGTH=2,GRPNAME=DATE'),
    ln('         DFHMSD TYPE=FINAL'),
  ].join('\n');
  const bms = parseBms(src);
  assert.deepEqual(bms.diags, []);
  assert.deepEqual(generatedRecords(bms), new Map([['DATEMO', ['DATE', 'MOA', 'MOO', 'SEP1O', 'DAYO', 'SEP2O', 'YRO']]]));
  const sep = fieldOf(bms, 'SEP1');
  assert.equal(sep.attrb, null);
  assert.deepEqual(sep.effective, new Set(['BRT', 'UNPROT']), 'MO\'s ATTRB=BRT, which makes the whole group enterable');
  assert.deepEqual(symbolIndex(bms).get('DATE'), [{ mapset: 'DATEMS', map: 'DATEM', field: null, suffix: null, record: 'DATEMO', group: 'DATE' }]);

  const resumed = parseBms([ln('S        DFHMSD TYPE=DSECT'), ln('M        DFHMDI SIZE=(24,80)'),
    ln('A        DFHMDF POS=(1,1),LENGTH=2,ATTRB=BRT,GRPNAME=G'), ln('B        DFHMDF POS=(1,4),LENGTH=2,ATTRB=PROT,GRPNAME=G'),
    ln('C        DFHMDF POS=(1,8),LENGTH=2'), ln('D        DFHMDF POS=(1,12),LENGTH=2,GRPNAME=G'), ln('         DFHMSD TYPE=FINAL')].join('\n'));
  assert.deepEqual(resumed.diags.map((d) => [d.sev, d.line]), [['warn', 4], ['error', 6]]);
  assert.deepEqual(fieldOf(resumed, 'B').effective, new Set(['BRT', 'UNPROT']), 'B\'s own PROT is not the one BMS uses');
});

test('MODE decides which records exist, and SUFFIX renames neither', () => {
  const one = (options) => parseBms([ln(`S        DFHMSD TYPE=DSECT,LANG=COBOL${options}`), ln('M        DFHMDI SIZE=(24,80)'),
    ln('F        DFHMDF POS=(1,1),LENGTH=4,ATTRB=UNPROT'), ln('         DFHMSD TYPE=FINAL')].join('\n'));
  const records = (bms) => [...generatedRecords(bms)];
  assert.deepEqual(records(one('')), [['MO', ['FA', 'FO']]], 'OUT when MODE is not given, and A moves to the output record');
  assert.deepEqual(records(one(',MODE=IN')), [['MI', ['FL', 'FF', 'FA', 'FI']]]);
  assert.deepEqual(records(one(',MODE=INOUT,EXTATT=YES')), [['MI', ['FL', 'FF', 'FA', 'FI']], ['MO', ['FC', 'FP', 'FH', 'FV', 'FO']]]);
  assert.deepEqual(records(one(',MODE=INOUT,SUFFIX=9')), records(one(',MODE=INOUT')), 'one symbolic map serves every suffixed version');
});

test('laid out either way the assembler allows, a map reads the same', () => {
  for (const member of ['COSGN00', 'COCRDSL']) {
    const src = fixture(`${member}.bms`);
    const original = shape(parseBms(src));
    for (const lay of [packed, perLine]) {
      const again = parseBms(relayout(src, lay));
      assert.deepEqual(again.diags, [], `${member} ${lay.name}`);
      assert.deepEqual(shape(again), original, `${member} ${lay.name}`);
    }
  }
});

test('statements out of place are reported and kept, not dropped', () => {
  const src = [
    ln('LOST     DFHMDF POS=(1,1),LENGTH=4'),
    ln('S        DFHMSD TYPE=DSECT,MODE=INOUT'),
    ln('M        DFHMDI SIZE=(24,80)'),
    ln('ZERO     DFHMDF POS=(2,1),LENGTH=0'),
    ln('         COPY MOREMAP'),
    ln('         DFHMXX POS=(3,1)'),
  ].join('\n');
  const bms = parseBms(src);
  assert.equal(bms.mapsets.length, 2);
  assert.deepEqual(bms.mapsets[0].maps[0].fields.map((f) => f.name), ['LOST']);
  assert.deepEqual(bms.diags.map((d) => [d.sev, d.line]), [
    ['error', 1], ['error', 1], ['warn', 4], ['warn', 5], ['info', 6], ['warn', 2],
  ]);
});

test('BMS is a file kind of its own, by extension or by a DFHMSD in a member with none', () => {
  assert.equal(isBms('app/bms/COSGN00.bms'), true);
  assert.equal(isBms('MAPS/COSGN00.BMS'), true);
  assert.equal(isSource('app/bms/COSGN00.bms'), false, 'no set that reads every source file reads maps yet');
  const dir = mkdtempSync(join(tmpdir(), 'cw-bms-'));
  try {
    const put = (name, text) => { writeFileSync(join(dir, name), text); return join(dir, name); };
    const map = put('COSGN00', fixture('COSGN00.bms'));
    const job = put('PAYJOB', '//PAYJOB   JOB (ACCT),CLASS=A\n//STEP1    EXEC PGM=IEFBR14\n');
    const prog = put('PAYCALC', '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. PAYCALC.\n');
    const note = put('NOTES', '* DFHMSD is mentioned here only in a comment.\n');
    assert.equal(sniffKind(map), 'bms');
    assert.equal(isBms(map), true);
    assert.equal(isSource(map), false, 'isSource answers as it did before BMS was a kind');
    assert.equal(isJcl(job), true);
    assert.equal(isProgram(prog), true);
    assert.equal(isBms(job) || isBms(prog), false);
    assert.equal(sniffKind(note), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
