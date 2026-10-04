// SPDX-License-Identifier: AGPL-3.0-or-later
// The EXEC CICS half of lib/precompile.mjs: what one CICS command becomes, and the copybooks a CICS
// program copies that no repository holds. The commands, the direction each option's data moves and
// the DFHRESP and DFHVALUE numbers are IBM's, recorded with their pages in provenance/precompile.json.
import { EIB_LAYOUT } from './words.mjs';
import { CICS_COMMANDS, CICS_EVERY_COMMAND, DFHRESP, DFHVALUE, DFHAID_NAMES, DFHBMSCA_NAMES } from './cics-commands.mjs';

// The number DFHRESP(name) or DFHVALUE(name) stands for, or undefined for a name IBM's tables lack.
export const builtinValue = (fn, name) => (fn === 'RESP' ? DFHRESP : DFHVALUE)[name];

// Whitespace runs outside literals, as one space.
const squeeze = (text) => text.replace(/('[^']*'|"[^"]*")|\s+/g, (_, lit) => lit || ' ').trim();

// The options of an EXEC CICS command in order: each word, with its argument's text when it has one.
export function cicsOptions(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const m = /^[\s,]*([A-Z0-9][A-Z0-9-]*)/i.exec(text.slice(i));
    if (!m) { i++; continue; }
    i += m[0].length;
    const word = m[1].toUpperCase();
    const p = /^\s*\(/.exec(text.slice(i));
    if (!p) { out.push({ word }); continue; }
    i += p[0].length;
    let depth = 1;
    let quote = null;
    let arg = '';
    for (; i < text.length; i++) {
      const ch = text[i];
      if (quote) { if (ch === quote) quote = null; } else if (ch === "'" || ch === '"') quote = ch;
      else if (ch === '(') depth++;
      else if (ch === ')' && --depth === 0) break;
      arg += ch;
    }
    i++;
    out.push({ word, arg: squeeze(arg) });
  }
  return out;
}

// Which table entry a command is: the one an option word identifies (SEND MAP by MAP), else the verb
// alone, else the one IBM makes the default (READQ is READQ TS).
export function cicsCommand(options) {
  const verb = options[0]?.word;
  const words = new Set(options.slice(1).map((o) => o.word));
  const names = Object.keys(CICS_COMMANDS).filter((n) => n === verb || n.startsWith(`${verb} `));
  return names.find((n) => CICS_COMMANDS[n].identify?.some((w) => words.has(w)))
    || names.find((n) => n === verb) || names.find((n) => CICS_COMMANDS[n].default) || null;
}

// A literal, a figurative constant or anything computed can only be sent, whatever its option does.
const LITERAL = /^(?:[A-Z]{0,2}(['"])[\s\S]*\1|[+-]?\d*\.?\d+|(?:ZEROE?S?|SPACES?|LOW-VALUES?|HIGH-VALUES?|QUOTES?|NULLS?|ALL\s.+))$/i;
const COMPUTED = /^(?:LENGTH\s+OF|FUNCTION)\s/i;

// The commands that set or clear how a later condition, attention key or abend is handled.
const HANDLERS = new Set(['HANDLE CONDITION', 'HANDLE AID', 'HANDLE ABEND', 'IGNORE CONDITION', 'PUSH HANDLE', 'POP HANDLE']);

// The EIB halfword a HANDLE's GO TO ... DEPENDING ON reads: 0 when the HANDLE itself runs, so control
// falls through, and the label's position when CICS later returns there to take the branch.
export const SELECTOR = 'DFHEIGDI';

// What one EXEC CICS block becomes: a CALL naming the command, then each argument by its option's
// direction, then the EIB, which every command updates. A command the table lacks passes every data
// name BY REFERENCE, since nothing says what it does not write. A HANDLE with labels is followed by the
// GO TO ... DEPENDING ON its branch is taken through. `state` carries whether the block is in the
// procedure division, has the EIB and the selector, and collects the handlers and the counts.
export function translateCics(block, state) {
  if (!state.procedure) return '';
  const options = cicsOptions(block.text);
  if (!options.length) return 'CONTINUE';
  const name = cicsCommand(options);
  const command = name && CICS_COMMANDS[name];
  const second = options[1];
  const callName = name || [options[0].word, ...(second && second.arg === undefined && second.word !== 'NOHANDLE' ? [second.word] : [])].join(' ');
  if (!command) state.unknown++;
  if (HANDLERS.has(name)) state.handlers.push({ line: block.line + 1, command: name, options: Object.fromEntries(options.slice(name.split(' ').length).map((o) => [o.word, o.arg ?? null])) });
  const sending = [];
  const receiving = [];
  const labels = [];
  const pass = (text, direction) => {
    const list = direction === 'sends' || LITERAL.test(text) || COMPUTED.test(text) ? sending : receiving;
    if (!list.includes(text)) list.push(text);
  };
  for (const o of options.slice(1)) {
    if (!o.arg) continue;
    const direction = command ? (command.options[o.word] || CICS_EVERY_COMMAND[o.word] || command.anyOption) : null;
    if (direction === 'label') { labels.push(o.arg); continue; }
    if (command && !direction) state.undirected++;
    const builtin = /^DFH(RESP|VALUE)\s*\(\s*([A-Z0-9-]+)\s*\)$/i.exec(o.arg);
    const value = builtin ? builtinValue(builtin[1].toUpperCase(), builtin[2].toUpperCase()) : undefined;
    if (builtin && value === undefined) state.unresolved++;
    pass(value === undefined ? o.arg : String(value), builtin ? 'sends' : direction);
  }
  // RECEIVE MAP without INTO writes the map's input record, SEND MAP without FROM reads its output one.
  const written = new Set(options.map((o) => o.word));
  for (const [option, d] of Object.entries(command?.defaults || {})) {
    const map = /^(['"])([A-Z0-9$#@]+)\1$/i.exec(options.find((o) => o.word === d.name)?.arg || '');
    if (map && !written.has(option) && !d.unless.some((w) => written.has(w))) pass(`${map[2].toUpperCase()}${d.suffix}`, command.options[option]);
  }
  const content = sending.filter((t) => !receiving.includes(t));
  if (state.eib) receiving.push('DFHEIBLK');
  const args = [...(content.length ? ['BY CONTENT', ...content] : []), ...(receiving.length ? ['BY REFERENCE', ...receiving] : [])];
  state.translated++;
  const branch = labels.length && state.selector ? [`GO TO ${labels.join(' ')} DEPENDING ON ${SELECTOR}`] : [];
  return [`CALL 'CW-CICS-${callName.split(' ').join('-')}'`, ...(args.length ? ['USING', ...args] : []), ...branch].join(' ');
}

// The EXEC interface block the translator declares for every program with CICS in it, with the
// selector a HANDLE's branch reads in the reserved halfword after EIBTRMID.
export function eibCopybook() {
  const fields = EIB_LAYOUT.flatMap(([n, pic]) => [[n, pic], ...(n === 'EIBTRMID' ? [[SELECTOR, 'S9(4) COMP']] : [])]);
  return ['       01 DFHEIBLK.', ...fields.map(([n, pic]) => `          05 ${n} PIC ${pic}.`), ''].join('\n');
}

// DFHAID and DFHBMSCA are IBM's and in no repository; each name is declared as one character, enough
// for a program that compares EIBAID with one or moves one to an attribute byte.
export const CONSTANT_COPYBOOKS = { DFHAID: DFHAID_NAMES, DFHBMSCA: DFHBMSCA_NAMES };
export const constantsCopybook = (names) => `${names.map((n) => `       01 ${n} PIC X.`).join('\n')}\n`;

// A mapset's symbolic map, laid out the way the BMS assembler lays one out for COBOL: the 12-byte
// prefix when TIOAPFX=YES, then for each named field its length, flag or attribute byte, extended
// attribute bytes and data, the output record redefining the input. Grouped (GRPNAME) and OCCURS
// fields are laid out differently, and a mapset holding either is not written. Returns the copybook
// text, the names it declares and, for each of its lines, the BMS line it comes from; or null.
const ATTRIBUTE_LETTER = { COLOR: 'C', PS: 'P', HILIGHT: 'H', VALIDN: 'V', OUTLINE: 'U', SOSI: 'M', TRANSP: 'T' };
export function symbolicMapCopybook(mapset) {
  const out = [];
  const names = [];
  const lines = [];
  let from = mapset.line;
  const line = (s) => { out.push(`       ${s}`); lines.push(from); };
  const declare = (n, s) => { names.push(n); line(s); };
  // The assembler writes FILLER; each gets a name here, the layout unchanged, so the grade can tell
  // the stand-in's items from the program's.
  let k = 0;
  const filler = (rec) => { const n = `${rec}-F${++k}`; names.push(n); return n; };
  for (const map of mapset.maps) {
    const fields = map.fields.filter((f) => f.name);
    if (fields.some((f) => f.grpname || f.occurs > 1)) return null;
    const { input, output, attributes } = map.symbolic;
    if (!input && !output) continue;
    from = map.line;
    const prefix = String(map.operands?.get?.('TIOAPFX') ?? mapset.options.tioapfx ?? '').toUpperCase() === 'YES';
    const pic = (f, which) => f[which] || `X(${f.length})`;
    if (input) {
      declare(input, `01  ${input}.`);
      if (prefix) line(`    02  ${filler(input)} PIC X(12).`);
      for (const f of fields) {
        const n = f.name.toUpperCase();
        from = f.line;
        declare(`${n}L`, `    02  ${n}L COMP PIC S9(4).`);
        declare(`${n}F`, `    02  ${n}F PIC X.`);
        line(`    02  ${filler(input)} REDEFINES ${n}F.`);
        declare(`${n}A`, `      03  ${n}A PIC X.`);
        if (attributes.length) line(`    02  ${filler(input)} PIC X(${attributes.length}).`);
        declare(`${n}I`, `    02  ${n}I PIC ${pic(f, 'picin')}.`);
      }
    }
    if (output) {
      from = map.line;
      declare(output, input ? `01  ${output} REDEFINES ${input}.` : `01  ${output}.`);
      if (prefix) line(`    02  ${filler(output)} PIC X(12).`);
      for (const f of fields) {
        const n = f.name.toUpperCase();
        from = f.line;
        if (input) line(`    02  ${filler(output)} PIC X(3).`);
        else { line(`    02  ${filler(output)} PIC X(2).`); declare(`${n}A`, `    02  ${n}A PIC X.`); }
        for (const a of attributes) declare(`${n}${ATTRIBUTE_LETTER[a]}`, `    02  ${n}${ATTRIBUTE_LETTER[a]} PIC X.`);
        declare(`${n}O`, `    02  ${n}O PIC ${pic(f, 'picout')}.`);
      }
    }
  }
  return out.length ? { text: `${out.join('\n')}\n`, names, lines } : null;
}
