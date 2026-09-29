// Reader for GnuCOBOL's own listing (cobc -t <file> -Xref -ftsymbols). The listing is the answer
// key this project grades itself against: it carries every data item with the size the compiler
// computed, every section and paragraph, called programs, and which references write to a field.
//
// Its quirks are the compiler's, not ours, and each one below was measured:
//   - names truncate to 30 characters, labels and called programs to 28
//   - any name starting FILLER prints as FILLER
//   - ", REDEFINES x" is appended straight after the name, so names can end with a comma
//   - section headers repeat on every page, and a program's block is headed PROGRAM or FUNCTION
//   - a size wider than the five-column field shifts every later column
//   - index names and level-78 constants never appear
export const SPECIAL_REGISTERS = new Set(['RETURN-CODE', 'SORT-RETURN', 'NUMBER-OF-CALL-PARAMETERS', 'TALLY', 'COB-CRT-STATUS',
  'LINAGE-COUNTER', 'XML-CODE', 'JSON-CODE', 'SORT-MESSAGE', 'SORT-CORE-SIZE', 'SORT-FILE-SIZE', 'SORT-MODE-SIZE']);

export function parseListing(text) {
  const out = { symbols: [], xref: [], labels: [], calls: [], entries: [], programs: new Set() };
  let mode = null;
  let prog = '';
  let last = null;
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\f/g, '').replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^GnuCOBOL \d/.test(line)) continue;
    if (/^LINE\s+PG\/LN/.test(line)) { mode = 'src'; continue; }
    if (/^SIZE\s+TYPE\s+LVL\s+NAME/.test(line)) { mode = 'sym'; continue; }
    if (/^NAME\s+DEFINED\s+REFERENCES/.test(line)) { mode = 'xref'; continue; }
    if (/^LABEL\s+DEFINED\s+REFERENCES/.test(line)) { mode = 'label'; continue; }
    if (/^FUNCTION\s+TYPE\s+REFERENCES/.test(line)) { mode = 'func'; continue; }
    if (/^Error\/Warning summary/.test(line) || /in compilation group$/.test(line)) { mode = 'end'; continue; }
    if (mode === 'sym') {
      const wide = /^(\d{6,})\s+(\S+)\s+(?:(\d{1,2})\s+)?(\S+)/.exec(line);
      const size = wide ? wide[1] : line.slice(0, 5).trim();
      const type = wide ? wide[2] : line.slice(6, 21).trim();
      const lvl = wide ? (wide[3] || '') : line.slice(21, 26).trim();
      const name = ((wide ? wide[4] : line.slice(26).trim().split(/\s+/)[0]) || '').toUpperCase().replace(/,$/, '');
      if (type === 'PROGRAM' || type === 'FUNCTION') { prog = name; out.programs.add(name); continue; }
      if (!lvl && /SECTION$/.test(line.trim())) continue;
      const sz = /^\d+$/.test(size) ? Number(size) : null;
      if (type === 'FILE') { out.symbols.push({ prog, lvl: 'FD', name, size: sz }); continue; }
      if (/^\d+$/.test(lvl)) { if (!(lvl === '77' && SPECIAL_REGISTERS.has(name))) out.symbols.push({ prog, lvl: String(Number(lvl)), name, size: sz, type }); }
      else out.unparsedSym = (out.unparsedSym || 0) + 1;
      continue;
    }
    if (mode === 'xref' || mode === 'label' || mode === 'func') {
      const pm = /^(?:PROGRAM|FUNCTION) (\S+)$/.exec(line);
      if (pm) { prog = pm[1].toUpperCase(); out.programs.add(prog); continue; }
    }
    if (mode === 'xref') {
      const m = /^(\S+)\s+(\d+)\s+(.*)$/.exec(line);
      if (m) {
        const rest = m[3];
        const state = /^not referenced/.test(rest) ? 'none' : /^referenced by child/.test(rest) ? 'child' : /^referenced by parent/.test(rest) ? 'parent' : 'refs';
        last = { prog, name: m[1].toUpperCase(), line: Number(m[2]), state, receiving: /\*\d/.test(rest) };
        out.xref.push(last);
      } else if (last && /^\s+[*\d]/.test(line) && /\*\d/.test(line)) last.receiving = true;
      continue;
    }
    if (mode === 'label') {
      const m = /^([ESP]) (\S+)\s+(\d+)/.exec(line);
      if (m && m[1] === 'E') out.entries.push({ prog, name: m[2], line: Number(m[3]) });
      else if (m && !m[2].startsWith('L$')) out.labels.push({ prog, kind: m[1], name: m[2].toUpperCase().slice(0, 28) });
      continue;
    }
    if (mode === 'func') {
      const m = /^([LIE]) (\S+)\s+\S+/.exec(line);
      if (m && !out.calls.some(c => c.prog === prog && c.kind === m[1] && c.name === m[2].slice(0, 28))) out.calls.push({ prog, kind: m[1], name: m[2].slice(0, 28) });
    }
  }
  out.programs = [...out.programs];
  return out;
}

// A listing produced under the wrong source format is a degenerate witness: the compiler accepts
// the file, reads almost none of it, and prints an answer key that looks like a clean one. Counting
// level-01 and level-77 lines with a plain regex is independent of the parser being graded.
export function looksDegenerate(listing, src) {
  const regex01 = src.split(/\r?\n/).filter(l => !/^.{6}[*/]/.test(l) && !/^\s*\*>/.test(l) && /^(?:.{7})?\s*(?:01|77)\s+[A-Za-z][\w-]*/.test(l)).length;
  const witness01 = listing.symbols.filter(x => x.lvl === '1' || x.lvl === '77').length;
  if (regex01 > 0 && witness01 < 0.5 * regex01) return true;
  // A comment-entry read as running to the end of the file hides the procedure division, and the
  // program still compiles, its entry point placed after the last line of the source.
  const lines = src.replace(/\s+$/, '').split(/\r?\n/);
  const code = (l) => l.trim() && !/^.{6}[*/]/.test(l) && !/^\s*\*>/.test(l);
  const proc = lines.findIndex(l => code(l) && /\bPROCEDURE\s+DIVISION\b/i.test(l));
  if (proc < 0 || !lines.slice(proc + 1).some(code)) return false;
  return (listing.entries || []).some(e => e.line > lines.length);
}
