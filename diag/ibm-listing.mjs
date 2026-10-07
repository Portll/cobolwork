// Reader for an Enterprise COBOL compile listing as the spool carries it: the compiler and its
// options, each compilation unit's source as card images with COPY-expanded lines marked, its Data
// Division Map, and its diagnostics. Read from public listings of levels 4.1 to 6.5: the columns
// move between levels, so each section's columns come from its own heading line.
//
// A map item's displacement is within its own level-01 or level-77 record. From 5.1 on the listing
// prints it so, in nine hex digits; 4.2 prints three hex digits from the base locator, and the
// record's own displacement is subtracted. The length comes from the assembler definition: DS 0CLn
// is a group of n bytes, DS nC n bytes, DS nP n packed bytes; H, F, D, E, L and N are 2, 4, 8, 4,
// 16 and 2 bytes each.
const UNIT_BYTES = { C: 1, P: 1, X: 1, N: 2, H: 2, F: 4, E: 4, D: 8, L: 16 };
const HEADER = /PP (\d{4}-[A-Z0-9]{3}) (IBM [A-Za-z/& ]*COBOL[A-Za-z/& ]*?)\s+(\d+\.\d+(?:\.\d+)?)(?:\s+(P\d{6}))?/;
const DIAGNOSTIC = /^\s*(\d+)\s+(IGY[A-Z]{2}\d{4}-([IWESU]))\s+(.*)$/;
const INLINE_DIAGNOSTIC = /^\s*==(\d+)==>\s+(IGY[A-Z]{2}\d{4}-([IWESU]))\s+(.*)$/;
const MAP_ITEM = /^\s*(\d+)\s+(FD|SD|RD|CD|\d+)\s+([A-Za-z0-9][A-Za-z0-9-]*)\.*(?:\s\.)*\s*(.*)$/;
const MAP_REST = /^(?:(BL[A-Z])=(\d+))?\s*([0-9A-F]{3,9})?(?:\s+(\d(?:\s[0-9A-F]{3}){2}))?\s*(?:DS (\S+))?\s*([A-Za-z][A-Za-z-]*)?\s*(.*)$/;
const END_OF_COMPILATION = /End of compilation \d+,\s+program (\S+),\s+(.*)\.$/;

export function parseIbmListing(text) {
  const out = { compiler: null, options: [], units: [], returnCode: null };
  let unit = null;
  let mode = null;
  let idAt = -1;
  let cardAt = -1;
  let lastDiagnostic = null;
  const open = () => {
    if (!unit) unit = { name: null, source: [], map: [], diagnostics: [], highestSeverity: null, recordAt: 0, mapProgram: null };
    return unit;
  };
  const close = () => {
    if (!unit) return;
    const listed = new Set(unit.diagnostics.filter((d) => !d.inline).map((d) => `${d.line} ${d.id}`));
    unit.diagnostics = unit.diagnostics.filter((d) => !d.inline || !listed.has(`${d.line} ${d.id}`));
    delete unit.recordAt;
    delete unit.mapProgram;
    out.units.push(unit);
    unit = null;
  };
  // A form feed starts a page as a new line does: some spools carry one mid-line, the page header
  // spliced onto a source line, and a capture tool may have rendered it as the two characters ^L.
  for (const raw of text.split(/\r?\n|\f|\^L(?=1?PP \d{4}-)/)) {
    const line = withoutCarriageControl(raw);
    const trimmed = line.trim();
    if (HEADER.test(line)) {
      if (!out.compiler) {
        const m = HEADER.exec(line);
        out.compiler = `${m[2].trim()} ${m[3]}${m[4] ? ' ' + m[4] : ''}`;
      }
      continue;
    }
    if (/^Options in effect:?$/.test(trimmed)) { mode = 'options'; continue; }
    // Column positions come from the raw line: the carriage-control column is part of them.
    if (raw.includes('LineID') && raw.includes('PL SL')) {
      idAt = raw.indexOf('LineID');
      cardAt = raw.indexOf('----+-*A');
      if (cardAt < 0) cardAt = idAt + 17;
      mode = 'source';
      open();
      continue;
    }
    if (trimmed === 'Data Division Map') { mode = 'map'; open(); continue; }
    // 4.2 ends its map with no closing line; the next section is the program global table.
    if (trimmed === 'End of Data Division Map' || /^(PROGRAM GLOBAL TABLE|LITERAL POOL|Line\s+#\s+Hexloc\s+Verb)/i.test(trimmed)) { mode = null; continue; }
    if (/^LineID\s+Message code\s+Message text/.test(trimmed)) { mode = 'diagnostics'; open(); continue; }
    if (/^Messages\s+Total\s+Informational/.test(trimmed) || /^Cross-reference of /.test(trimmed) || /^Nested Program Map/.test(trimmed) || /^Statistics for COBOL program/.test(trimmed)) mode = null;
    const end = END_OF_COMPILATION.exec(trimmed);
    if (end) {
      const u = open();
      u.name = end[1];
      u.highestSeverity = end[2];
      close();
      mode = null;
      continue;
    }
    const rc = /^Return code (\d+)$/.exec(trimmed);
    if (rc) { out.returnCode = Number(rc[1]); continue; }

    if (mode === 'options') {
      const tokens = trimmed.split(/\s{2,}/).map((t) => t.trim()).filter(Boolean);
      if (tokens.length === 0 || !tokens.every(isOption)) mode = null;
      else out.options.push(...tokens);
      continue;
    }
    if (mode === 'source') {
      const inline = INLINE_DIAGNOSTIC.exec(line);
      if (inline) { unit.diagnostics.push({ line: Number(inline[1]), id: inline[2], severity: inline[3], text: inline[4].trim(), inline: true }); continue; }
      const id = raw.slice(idAt, idAt + 6);
      if (!/^\d{6}$/.test(id)) continue;
      const card = raw.slice(cardAt, cardAt + 80);
      unit.source.push({ line: Number(id), card, copied: raw[idAt + 6] === 'C' });
      if (!unit.name && card[6] !== '*') {
        const pid = /PROGRAM-ID\s*\.?\s*['"]?([A-Za-z0-9-]+)/.exec(card.slice(7, 72));
        if (pid) unit.name = pid[1].toUpperCase();
      }
      continue;
    }
    if (mode === 'map') {
      const program = /^\s*\d+\s+PROGRAM-ID (\S+?)-*\*?$/.exec(line);
      if (program) { unit.mapProgram = program[1]; continue; }
      const m = MAP_ITEM.exec(line);
      if (!m) continue;
      const r = MAP_REST.exec(m[4]);
      const level = /^\d+$/.test(m[2]) ? Number(m[2]) : m[2];
      const at = r[3] ? parseInt(r[3], 16) : null;
      if (level === 1 || level === 77 || typeof level === 'string') unit.recordAt = at ?? 0;
      unit.map.push({
        program: unit.mapProgram ?? unit.name,
        line: Number(m[1]),
        level,
        name: m[3].toUpperCase(),
        base: r[1] ? `${r[1]}=${r[2]}` : null,
        displacement: at == null ? null : at - unit.recordAt,
        bytes: r[5] ? bytesOf(r[5]) : null,
        def: r[5] ?? null,
        type: r[6] ?? null,
        attrs: r[7].trim(),
      });
      continue;
    }
    if (mode === 'diagnostics') {
      const d = DIAGNOSTIC.exec(line);
      if (d) {
        lastDiagnostic = { line: Number(d[1]), id: d[2], severity: d[3], text: d[4].trim(), inline: false };
        unit.diagnostics.push(lastDiagnostic);
      } else if (lastDiagnostic && /^\s{10,}\S/.test(line)) {
        lastDiagnostic.text += ' ' + trimmed;
      }
    }
  }
  close();
  return out;
}

export function bytesOf(def) {
  const m = /^(\d+)([A-Z]+)(\d*)$/.exec(def);
  if (!m) return null;
  if (m[2] === 'CL') return Number(m[3]);
  const unit = UNIT_BYTES[m[2]];
  return unit == null ? null : Number(m[1]) * unit;
}

// The unit's source as the compiler saw it: COPY-expanded lines kept, and the COPY or EXEC SQL
// INCLUDE statement each expansion replaces turned into a comment, so a parser reads the text
// once and resolves no copybook. The statement is sought within the eight lines before the
// expansion; an expansion with no such statement before it is left as it stands.
export function sourceText(unit) {
  const cards = unit.source.map((s) => ({ ...s }));
  for (let i = 0; i < cards.length; i++) {
    if (!cards[i].copied || (i > 0 && cards[i - 1].copied)) continue;
    const from = Math.max(0, i - 8);
    let at = -1;
    for (let j = i - 1; j >= from && !cards[j].copied; j--) {
      if (/\b(COPY|INCLUDE)\b/i.test(cards[j].card.slice(7, 72))) { at = j; break; }
    }
    if (at < 0) continue;
    // An INCLUDE sits inside EXEC SQL … END-EXEC: the whole statement goes.
    if (/\bINCLUDE\b/i.test(cards[at].card.slice(7, 72))) while (at > from && !/\bEXEC\b/i.test(cards[at].card.slice(7, 72))) at--;
    for (let j = at; j < i; j++) cards[j].card = cards[j].card.slice(0, 6) + "*" + cards[j].card.slice(7);
  }
  return cards.map((s) => s.card.replace(/\s+$/, "")).join("\n") + "\n";
}

function withoutCarriageControl(line) {
  return /^[10+-]/.test(line) ? line.slice(1) : line;
}

function isOption(token) {
  return /^[A-Z][A-Z0-9]*(\([^)]*\))?$/.test(token);
}
