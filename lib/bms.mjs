// SPDX-License-Identifier: AGPL-3.0-or-later
// BMS maps, read the way the assembler reads them: DFHMSD opens a mapset, DFHMDI a map in it,
// DFHMDF a field in that, and DFHMSD TYPE=FINAL closes the set.
//
//   COSGN00 DFHMSD LANG=COBOL,MODE=INOUT,TYPE=&&SYSPARM
//   COSGN0A DFHMDI SIZE=(24,80)
//   PASSWD  DFHMDF POS=(20,43),LENGTH=8,ATTRB=(DRK,FSET,UNPROT)
//
// A field's attributes are enforced by the 3270 emulator, not by CICS: a modified client writes a
// PROT field and reads a DRK one, which makes them what a hidden field is to a web form. So ATTRB
// is kept as the set of keywords the map declares, and each named field is tied to the names a
// COBOL program uses for it (PASSWDI, PASSWDL, PASSWDA and the rest, in COSGN0AI and COSGN0AO),
// because a program never uses the DFHMDF label itself. A DFHMDF with no label is a constant on
// the screen and has no names; it is kept, with name null, so that it cannot pass for a data field.
//
// This reads text and opens nothing; the caller reads the file through the source tree, so
// containment stays where it is enforced.
import { parseOperands, splitOperands } from './cards.mjs';

// Column 72 marks a continuation and 73 to 80 are the sequence field, so a statement ends at 71.
const END_COLUMN = 71;
const CONTINUE_COLUMN = 16;

const MACROS = new Set(['DFHMSD', 'DFHMDI', 'DFHMDF']);

// Assembler instructions a map source carries around its macros. Anything else in the operation
// field is a statement this reader does not know, which is a diagnostic rather than a silent skip.
const ASSEMBLER = new Set(['TITLE', 'PRINT', 'EJECT', 'SPACE', 'PUNCH', 'ICTL', 'ISEQ', 'COPY', 'END']);

const PROTECTION = ['ASKIP', 'PROT', 'UNPROT'];
const INTENSITY = ['BRT', 'NORM', 'DRK'];
const ATTRB_KEYWORDS = new Set([...PROTECTION, ...INTENSITY, 'NUM', 'DET', 'IC', 'FSET']);

// Each extended attribute DSATTS can give a subfield of its own, with the letter that subfield
// takes, in the order generated copybooks lay them out. The order of C, P, H, V, U and M is read
// from copybooks CICS generated; TRANSP last is an assumption, since no copybook seen carries it.
// https://www.ibm.com/docs/en/cics-ts/6.x?topic=output-setting-display-characteristics
const EXTENDED = [['COLOR', 'C'], ['PS', 'P'], ['HILIGHT', 'H'], ['VALIDN', 'V'], ['OUTLINE', 'U'], ['SOSI', 'M'], ['TRANSP', 'T']];
const LETTER = new Map(EXTENDED);
const EXTATT_YES = ['COLOR', 'HILIGHT', 'PS', 'VALIDN'];

const upper = (v) => (v == null ? null : String(v).toUpperCase());
const integer = (v) => (/^\d+$/.test(v ?? '') ? Number(v) : null);

// 'Tom''s' is Tom's: a quote or an ampersand inside a literal is written twice.
const unquote = (v) => {
  const m = /^'([\s\S]*)'$/.exec(v ?? '');
  return m ? m[1].replace(/''/g, "'").replace(/&&/g, '&') : (v ?? null);
};

// (ASKIP,NORM) and ASKIP are both lists; the parentheses are optional around one entry.
const sublist = (v) => {
  if (v == null) return null;
  const inner = /^\(([\s\S]*)\)$/.exec(v);
  return (inner ? splitOperands(inner[1]) : [v]).map((x) => x.trim()).filter(Boolean);
};

// L'NAME is NAME's length, and T', S', I', K', N', D' and O' its other attributes: the quote after the
// letter opens no string when the letter starts a term and a symbol, *, or a literal follows (L'*,
// L'=F'1'). CL8'TEXT' and D'1.5' are constants, and their quotes do open one.
// https://www.ibm.com/docs/en/hla-and-tf/1.6.0?topic=instructions-data-attributes
const attributeReference = (text, i) => /[LTSIKNDO]/i.test(text[i - 1] || '')
  && !/[A-Z0-9$#@_]/i.test(text[i - 2] || '') && /[A-Z$#@_&*=]/i.test(text[i + 1] || '');

// Folds physical lines into statements. A map continues a statement in two ways, often both in one
// file. An operand that fills the line to column 71 carries on in column 16 of the next line, which
// is how a long INITIAL literal is split. A comma followed by a blank ends the line's operands and
// leaves the rest of it as a remark, which is how a map written one operand per line reads. An
// operand written after that blank, or starting anywhere but column 16, is a remark to the
// assembler, so it is reported rather than read.
// https://www.ibm.com/docs/en/SSLTBW_2.1.0/com.ibm.zos.v2r1.asma400/cl.htm
// https://www.ibm.com/docs/en/SSLTBW_2.1.0/com.ibm.zos.v2r1.asma400/altwmac.htm
// batch: read on past END, as HLASM's BATCH option assembles the next program, and keep JCL, SMP/E and
// IEBUPDTE control cards and an end-of-file mark, which no assembler statement starts with, as
// not-assembler lines.
export function foldStatements(src, { batch = false } = {}) {
  const phys = String(src).replace(/\r\n?/g, '\n').split('\n');
  const statements = [];
  const diags = [];
  let open = null;       // { st, reading, quoted }: the statement the next line continues
  let ended = false;     // nothing after END is read, unless batch

  const remark = (text, line, why) => {
    if (/^[A-Z][A-Z0-9]*=/i.test(text)) diags.push({ sev: 'warn', line, text: `'${text}' ${why}, so the assembler reads it as a remark, not an operand` });
  };

  const read = (o, text, from, line) => {
    for (let i = from; i < text.length; i++) {
      const c = text[i];
      if (o.quoted) { o.st.field += c; if (c === "'") o.quoted = false; continue; }
      // The letter of an attribute reference can end the line before: L in column 71, its quote in column 16.
      if (c === "'" && attributeReference(o.st.field + text.slice(i), o.st.field.length)) { o.st.field += c; continue; }
      if (c === "'") { o.quoted = true; o.st.field += c; continue; }
      if (c === ' ' || c === '\t') {
        o.reading = o.st.field.endsWith(',');
        remark(text.slice(i).trim(), line, o.reading ? 'follows a comma and a blank' : 'follows the last operand');
        return;
      }
      o.st.field += c;
    }
    o.reading = o.quoted || text.length === END_COLUMN;
  };

  const finish = (o) => {
    if (o.quoted) diags.push({ sev: 'error', line: o.st.line, text: 'a quoted string is not closed' });
    statements.push(o.st);
  };

  for (let i = 0; i < phys.length && !ended; i++) {
    const line = i + 1;
    const raw = phys[i];
    let broke = null;
    if (raw.length > 80) diags.push({ sev: 'warn', line, text: 'line is longer than 80 columns' });
    const text = raw.slice(0, END_COLUMN);
    const continues = raw.length > END_COLUMN && raw[END_COLUMN] !== ' ';

    if (open) {
      if (/\S/.test(text.slice(0, CONTINUE_COLUMN - 1))) {
        // A comment banner that runs into column 72 is common and harmless; a statement is not.
        if (open.st.kind === 'statement') diags.push({ sev: 'error', line, text: `a continuation must leave columns 1 to ${CONTINUE_COLUMN - 1} blank, so this line was read as a new statement` });
        broke = open.st.kind;
        finish(open);
        open = null;
      } else {
        open.st.endLine = line;
        open.st.lines.push(line);
        if (open.reading) {
          if (!open.quoted && /^\s|^$/.test(text.slice(CONTINUE_COLUMN - 1))) {
            remark(text.trim(), line, `does not start in column ${CONTINUE_COLUMN}`);
            open.reading = false;
          } else read(open, text, CONTINUE_COLUMN - 1, line);
        }
        if (!continues) { finish(open); open = null; }
        continue;
      }
    }

    if (!text.trim()) continue;
    if (batch && /^(?:\/\/|\/\*|\+\+|\.\/|\x1a)/.test(text)) {
      statements.push({ kind: 'not-assembler', line, endLine: line, lines: [line], text });
      continue;
    }
    if (/^\*|^\.\*/.test(text)) {
      const st = { kind: 'comment', line, endLine: line, lines: [line], text: text.slice(1) };
      if (continues) open = { st, reading: false, quoted: false };
      else statements.push(st);
      continue;
    }
    const m = /^(\S*)[ \t]+(\S+)/.exec(text);
    if (!m) {
      diags.push({ sev: 'error', line, text: 'no operation field' });
      statements.push({ kind: 'unreadable', line, endLine: line, lines: [line], text });
      continue;
    }
    const st = { kind: 'statement', name: m[1] || null, operation: m[2].toUpperCase(), field: '', line, endLine: line, lines: [line] };
    // The line before continued, so the assembler reads this one as part of it: as comment text
    // after a comment, as an invalid continuation after a statement. It is read as a statement
    // all the same, and marked.
    if (broke) st.continues = broke;
    const o = { st, reading: true, quoted: false };
    let at = m[0].length;
    while (text[at] === ' ' || text[at] === '\t') at++;
    // An operation with nothing after it on its line takes its operands from the next line.
    if (at < text.length) read(o, text, at, line);
    if (continues) open = o;
    else finish(o);
    if (st.operation === 'END') ended = !batch;
  }

  if (open) {
    if (open.st.kind === 'statement') diags.push({ sev: 'error', line: open.st.line, text: 'statement ends on a continuation with nothing continuing it' });
    finish(open);
  }
  return { statements, diags };
}

// The attributes BMS gives a field. IBM: "If no ATTRB parameters are specified, ASKIP and NORM are
// assumed. If any parameter is specified, UNPROT and NORM are assumed for that field unless
// overridden by a specified parameter." So ATTRB=(BRT) is an unprotected field, which is not what
// it looks like. https://www.ibm.com/docs/en/cics-ts/6.x?topic=macros-dfhmdf
function effectiveAttrb(declared) {
  if (!declared) return new Set(['ASKIP', 'NORM']);
  const set = new Set(declared);
  if (!PROTECTION.some((k) => set.has(k))) set.add('UNPROT');
  if (!INTENSITY.some((k) => set.has(k))) set.add('NORM');
  return set;
}

// POS=(line,column) counts from one; POS=n is a displacement from zero into the map, so it needs
// the map's width to become a line and a column.
function position(v, size) {
  const list = sublist(v);
  if (!list) return null;
  if (list.length === 2 && list.every((x) => integer(x) !== null)) return { line: Number(list[0]), column: Number(list[1]) };
  const offset = list.length === 1 ? integer(list[0]) : null;
  if (offset === null) return undefined;
  if (!size) return { line: null, column: null, offset };
  return { line: Math.floor(offset / size.columns) + 1, column: (offset % size.columns) + 1, offset };
}

const lineOrColumn = (v) => (v == null ? null : integer(v) ?? upper(v));

// DSATTS names the extended attributes that get a subfield in the symbolic map, and EXTATT=YES is
// the older spelling of four of them. Given together they add up: every CBSA map gives both, and
// CBSA's generated copybooks carry V, which only EXTATT names, beside U and M, which only DSATTS
// does. A map that states either is taken to replace what its mapset stated; IBM does not say, and
// no copybook seen settles it. https://www.ibm.com/docs/en/cics-ts/6.x?topic=macros-dfhmsd
function extendedAttributes(keywords) {
  const extatt = upper(keywords.get('EXTATT'));
  if (!keywords.has('DSATTS') && extatt === null) return null;
  const types = new Set((sublist(keywords.get('DSATTS')) || []).map(upper));
  if (extatt === 'YES') for (const t of EXTATT_YES) types.add(t);
  return EXTENDED.map(([t]) => t).filter((t) => types.has(t));
}

// The records a COBOL program copies for a map: mapI for input and mapO for output, as MODE asks,
// OUT when it does not say. SUFFIX leaves them alone: IBM describes one symbolic map shared by every
// suffixed version of a mapset, the suffix choosing among physical maps only.
// https://www.ibm.com/docs/en/cics-ts/6.x?topic=map-device-dependent-maps
function symbolicMap(name, mapset, keywords) {
  const mode = mapset.options.mode || 'OUT';
  const base = upper(name);
  return {
    input: base && (mode === 'IN' || mode === 'INOUT') ? `${base}I` : null,
    output: base && (mode === 'OUT' || mode === 'INOUT') ? `${base}O` : null,
    attributes: extendedAttributes(keywords) ?? extendedAttributes(mapset.operands) ?? [],
    // OCCURS fields in the mapset's earlier maps, which the numbering of output arrays continues.
    occursBefore: mapset.maps.reduce((n, m) => n + m.fields.filter((f) => f.occurs > 1).length, 0),
  };
}

const where = (st) => ({ line: st.line, endLine: st.endLine, lines: st.lines });

function newMapset(st, keywords) {
  return {
    name: st?.name ?? null,
    ...(st ? where(st) : { line: null, endLine: null, lines: [] }),
    // As written. TYPE=MAP builds the screen and TYPE=DSECT the copybook; &SYSPARM, or &&SYSPARM,
    // leaves the choice to the assembly, which is usually run once for each.
    options: {
      type: upper(keywords.get('TYPE')),
      mode: upper(keywords.get('MODE')),
      lang: upper(keywords.get('LANG')),
      suffix: keywords.get('SUFFIX') ?? null,
      storage: upper(keywords.get('STORAGE')),
      base: keywords.get('BASE') ?? null,
      tioapfx: upper(keywords.get('TIOAPFX')),
      extatt: upper(keywords.get('EXTATT')),
      dsatts: sublist(keywords.get('DSATTS'))?.map(upper) ?? null,
      mapatts: sublist(keywords.get('MAPATTS'))?.map(upper) ?? null,
    },
    operands: keywords,
    maps: [],
    finalLine: null,
  };
}

function newMap(st, keywords, mapset, diags) {
  const size = sublist(keywords.get('SIZE'));
  const [lines, columns] = (size || []).map(integer);
  if (size && !(size.length === 2 && lines && columns)) diags.push({ sev: 'warn', line: st?.line ?? null, text: `SIZE=${keywords.get('SIZE')} is not (lines,columns)` });
  return {
    name: st?.name ?? null,
    mapset: mapset.name,
    ...(st ? where(st) : { line: null, endLine: null, lines: [] }),
    options: {
      size: lines && columns && size.length === 2 ? { lines, columns } : null,
      line: lineOrColumn(keywords.get('LINE')),
      column: lineOrColumn(keywords.get('COLUMN')),
      fields: upper(keywords.get('FIELDS')),
      justify: sublist(keywords.get('JUSTIFY'))?.map(upper) ?? null,
      extatt: upper(keywords.get('EXTATT')),
      dsatts: sublist(keywords.get('DSATTS'))?.map(upper) ?? null,
      mapatts: sublist(keywords.get('MAPATTS'))?.map(upper) ?? null,
    },
    operands: keywords,
    symbolic: symbolicMap(st?.name, mapset, keywords),
    fields: [],
  };
}

// { mapsets: [{ name, line, options: { type, mode, lang, suffix, storage, ... }, operands, maps,
// finalLine }], statements, diags }, a map being { name, mapset, line, options: { size, line,
// column, fields, ... }, operands, symbolic: { input, output, attributes, occursBefore }, fields }
// and a field { name, map, mapset, line, pos: { line, column[, offset] }, length, attrb, effective,
// picin, picout, initial, occurs, grpname, operands }. `operands` holds every keyword as written;
// `attrb` is the ATTRB operand as a set, null when it is not coded, and `effective` the set BMS
// applies.
export function parseBms(text) {
  const { statements, diags } = foldStatements(text);
  const mapsets = [];
  let mapset = null;
  let map = null;
  let group = null;      // { name, leader }: the GRPNAME group the previous field belonged to
  let groupsEnded = new Set();

  const implicitMapset = (st, what) => {
    diags.push({ sev: 'error', line: st.line, text: `${what} before any DFHMSD` });
    mapset = newMapset(null, new Map());
    mapsets.push(mapset);
  };

  for (const st of statements) {
    if (st.kind !== 'statement') continue;
    const { positional, keywords } = parseOperands(st.field);
    if (MACROS.has(st.operation) && positional.length) {
      diags.push({ sev: 'warn', line: st.line, text: `${st.operation} takes keyword operands only, so '${positional.join(',')}' was not read` });
    }

    switch (st.operation) {
      case 'DFHMSD': {
        if (upper(keywords.get('TYPE')) === 'FINAL') {
          if (mapset) mapset.finalLine = st.line;
          else diags.push({ sev: 'warn', line: st.line, text: 'DFHMSD TYPE=FINAL with no mapset open' });
          mapset = null;
          map = null;
          break;
        }
        if (mapset?.line) diags.push({ sev: 'warn', line: st.line, text: `mapset ${mapset.name} has no DFHMSD TYPE=FINAL before the next DFHMSD` });
        if (!st.name) diags.push({ sev: 'error', line: st.line, text: 'DFHMSD has no mapset name' });
        mapset = newMapset(st, keywords);
        mapsets.push(mapset);
        map = null;
        break;
      }

      case 'DFHMDI': {
        if (!mapset) implicitMapset(st, 'DFHMDI');
        if (!st.name) diags.push({ sev: 'error', line: st.line, text: 'DFHMDI has no map name, so its fields have no symbolic names' });
        map = newMap(st, keywords, mapset, diags);
        mapset.maps.push(map);
        group = null;
        groupsEnded = new Set();
        break;
      }

      case 'DFHMDF': {
        if (!map) {
          if (!mapset) implicitMapset(st, 'DFHMDF');
          diags.push({ sev: 'error', line: st.line, text: 'DFHMDF before any DFHMDI' });
          map = newMap(null, new Map(), mapset, diags);
          mapset.maps.push(map);
        }
        const coded = keywords.get('ATTRB');
        const attrb = coded ? new Set(sublist(coded).map(upper)) : null;
        for (const k of attrb || []) {
          if (!ATTRB_KEYWORDS.has(k)) diags.push({ sev: 'warn', line: st.line, text: `ATTRB keyword '${k}' is not one BMS defines` });
        }
        const pos = position(keywords.get('POS'), map.options.size);
        if (pos === undefined) diags.push({ sev: 'warn', line: st.line, text: `POS=${keywords.get('POS')} is neither (line,column) nor a number` });
        else if (pos && pos.line === null) diags.push({ sev: 'warn', line: st.line, text: `POS=${pos.offset} is an offset, and the map gives no SIZE to turn it into a line and a column` });

        const field = {
          name: st.name,
          map: map.name,
          mapset: map.mapset,
          ...where(st),
          pos: pos ?? null,
          length: integer(keywords.get('LENGTH')),
          attrb,
          effective: effectiveAttrb(attrb),
          picin: unquote(keywords.get('PICIN')),
          picout: unquote(keywords.get('PICOUT')),
          initial: unquote(keywords.get('INITIAL')),
          occurs: integer(keywords.get('OCCURS')),
          grpname: keywords.get('GRPNAME') ?? null,
          operands: keywords,
        };

        // A group has one attribute byte, so the first field's ATTRB applies to all of it, and its
        // fields must follow one another. IBM, DFHMDF: "The ATTRB operand specified on the first
        // field of the group applies to all of the fields within the group."
        // https://www.ibm.com/docs/en/cics-ts/6.x?topic=macros-dfhmdf
        // https://www.ibm.com/docs/en/cics-ts/6.x?topic=map-using-complex-fields
        const g = upper(field.grpname);
        if (g && group?.name === g) {
          if (attrb) diags.push({ sev: 'warn', line: st.line, text: `ATTRB on a later field of group ${g} is not used; the first field's applies to the group` });
          field.effective = new Set(group.leader.effective);
        } else {
          if (group) groupsEnded.add(group.name);
          if (g && groupsEnded.has(g)) diags.push({ sev: 'error', line: st.line, text: `GRPNAME=${g} resumes after other fields; a group's fields must follow one another` });
          group = g ? { name: g, leader: field } : null;
        }
        if (g && !st.name) diags.push({ sev: 'error', line: st.line, text: `every field of group ${g} needs a name` });
        if (g && field.occurs !== null) diags.push({ sev: 'error', line: st.line, text: 'OCCURS and GRPNAME cannot both be given' });
        if (st.name && field.length === 0) diags.push({ sev: 'warn', line: st.line, text: `field ${st.name} has LENGTH=0, which BMS allows only on a field with no name` });
        if (st.name && map.fields.some((f) => upper(f.name) === upper(st.name))) diags.push({ sev: 'warn', line: st.line, text: `field ${st.name} appears twice in map ${map.name}` });
        map.fields.push(field);
        break;
      }

      default:
        if (st.operation === 'COPY') diags.push({ sev: 'warn', line: st.line, text: `COPY ${st.field} was not resolved, so its statements were not read` });
        else if (!ASSEMBLER.has(st.operation)) diags.push({ sev: 'info', line: st.line, text: `operation '${st.operation}' is not a BMS macro, so the statement was not read` });
        break;
    }
  }

  // A mapset this reader opened for a stray statement has already been reported.
  if (mapset?.line) diags.push({ sev: 'warn', line: mapset.line, text: `mapset ${mapset.name} has no DFHMSD TYPE=FINAL` });
  return { mapsets, statements, diags };
}

// The COBOL names the symbolic map gives a field, each the field name and one letter: L the length
// of what was keyed, F its flag, A the attribute byte, I the data received, O the data sent, and a
// letter for each extended attribute. What a program reads from the terminal arrives in NAMEI.
// Returns [{ name, suffix, record[, occurs][, group] }] in record order, empty for a field with no
// name. https://www.ibm.com/docs/en/cics-ts/5.6.0?topic=example-symbolic-input-map
//
// With MODE=INOUT, A redefines F in the input record and the extended attributes precede O in the
// output record, as CardDemo's copybooks show. MODE=OUT puts A in the output record, as IBM's
// examples do; MODE=IN is taken to keep it beside F, which no copybook seen shows.
//
// OCCURS follows a copybook CICS TS 6.2 generated: the input side is an array NAMED of L, F and I,
// and the output side an array DFHMSn of A, the extended attributes and O. IBM's example names the
// output array TELNOG, after its field TELNO, which is not what the macros generate now. That
// copybook numbers two arrays in one map; that the count runs on through the mapset rather than
// starting again at each map is an assumption.
//
// In a GRPNAME group only the first field has L, F, A and the extended attributes, the others I and
// O, and the group name is an item in each record. That rests on IBM's output example alone; no
// generated group was available to check it.
// https://www.ibm.com/docs/en/cics-ts/6.x?topic=map-using-complex-fields
export function symbolicNames(map, field) {
  if (!field.name || !map.symbolic) return [];
  const { input, output, attributes, occursBefore } = map.symbolic;
  const base = upper(field.name);
  const extended = attributes.map((t) => LETTER.get(t));
  const group = upper(field.grpname);
  const leader = !group || map.fields.find((f) => upper(f.grpname) === group)?.line === field.line;
  const occurs = field.occurs > 1 ? field.occurs : null;

  const names = [];
  const lay = (record, head, suffixes) => {
    if (!record) return;
    if (head) names.push({ ...head, record });
    for (const suffix of suffixes) names.push({ name: base + suffix, suffix, record, ...(occurs ? { occurs } : {}) });
  };
  if (occurs) {
    const n = occursBefore + map.fields.filter((f) => f.occurs > 1 && f.line <= field.line).length;
    lay(input, { name: `${base}D`, suffix: 'D', occurs }, ['L', 'F', 'I']);
    lay(output, { name: `DFHMS${n}`, suffix: null, occurs }, ['A', ...extended, 'O']);
  } else if (!leader) {
    lay(input, null, ['I']);
    lay(output, null, ['O']);
  } else {
    const head = group ? { name: group, suffix: null, group } : null;
    if (input) {
      lay(input, head, ['L', 'F', 'A', 'I']);
      lay(output, head, [...extended, 'O']);
    } else lay(output, head, ['A', ...extended, 'O']);
  }
  return names;
}

// From a COBOL name back to what it stands for. One name can stand for several fields - TRNNAMEI
// is in every CardDemo map - so each hit carries the record it sits in, which is how a program
// qualifies it (USERIDI OF COSGN0AI). A record name itself is a hit with field null.
// Map(NAME -> [{ mapset, map, field, suffix, record[, occurs][, group] }])
export function symbolIndex(...parsed) {
  const index = new Map();
  const note = (name, hit) => {
    if (!index.has(name)) index.set(name, []);
    index.get(name).push(hit);
  };
  for (const bms of parsed) for (const ms of bms.mapsets) for (const map of ms.maps) {
    const at = { mapset: ms.name, map: map.name };
    if (map.symbolic.input) note(map.symbolic.input, { ...at, field: null, suffix: 'I', record: map.symbolic.input });
    if (map.symbolic.output) note(map.symbolic.output, { ...at, field: null, suffix: 'O', record: map.symbolic.output });
    for (const f of map.fields) {
      for (const { name, ...hit } of symbolicNames(map, f)) note(name, { ...at, field: hit.group ? null : f.name, ...hit });
    }
  }
  return index;
}
