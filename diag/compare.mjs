// Turns a parse result into the same shape the compiler's listing reports, so the two can be
// compared item for item. The normalisations here mirror listing quirks, never parser behaviour:
// changing one of these changes what we claim the compiler said.
const n30 = (s) => String(s).toUpperCase().slice(0, 30);
const n28 = (s) => String(s).toUpperCase().slice(0, 28);

// Verbs whose targets the compiler's listing never marks as receiving, though they do write to
// them. Extras from these verbs are a deliberate divergence, not a defect. What an EXEC block names
// reaches the compiler blanked or as a CALL argument, so its write is never marked either.
export const WITNESS_NEVER_MARKS = new Set(['CALL', 'PERFORM', 'UNSTRING', 'STRING', 'SEARCH', 'INSPECT', 'EXEC SQL', 'EXEC CICS']);

export function factsFromParse(parsed) {
  const single = parsed.programs.length <= 1;
  const facts = { symbols: [], xref: [], labels: [], calls: [] };
  for (const p of parsed.programs) {
    const prog = single ? '' : (p.id || '').replace(/^["']|["']$/g, '');
    for (const fd of p.fds || []) {
      facts.symbols.push({ prog, lvl: 'FD', name: n30(fd.name), size: fd.size });
      facts.xref.push({ prog, name: n30(fd.name), state: 'refs', receiving: !!fd.receiving, verbs: 'FILE', via: fd.receiving ? 'OPEN' : '' });
    }
    // The listing prints the groups of a program's last report description only, and no
    // communication section at all.
    const lastReport = (p.reports || []).at(-1);
    for (const it of p.items) {
      if (it.level === 78 || it.constant || it.section === 'COMMUNICATION') continue;
      if (it.section === 'REPORT' && (!lastReport || it.rd !== lastReport)) continue;
      // What a TYPE implies is referenced through the typed item, and never printed as an entry.
      if (!it.typeClone) facts.symbols.push({ prog, lvl: String(it.level), name: /^FILLER/.test(it.name) ? 'FILLER' : n30(it.name), size: it.level === 88 ? null : it.size, section: it.section });
      // A TYPEDEF's own subordinate items are not cross-referenced; the copies a TYPE implies are.
      let inTypedef = false;
      for (let q = it.parent; q; q = q.parent) if (q.typedef) { inTypedef = true; break; }
      if (it.name !== 'FILLER' && !inTypedef) facts.xref.push({ prog, name: n30(it.name), line: it.line, state: it.refState, receiving: it.receiving, via: [...(it.receivingVia || [])].join(','), verbs: [...(it.refVerbs || [])].join(',') });
    }
    for (const l of p.labels) facts.labels.push({ prog, kind: l.kind, name: n28(l.name) });
    for (const c of p.calls) {
      // The listing prints a hexadecimal call target, Micro Focus's call by number, as its bytes.
      const literal = c.hex ? Buffer.from(c.name, 'hex').toString('latin1') : c.name;
      const name = n28(c.kind === 'L' ? literal : n30(c.name)).toUpperCase();
      if (!facts.calls.some(x => x.prog === prog && x.kind === c.kind && x.name === name)) facts.calls.push({ prog, kind: c.kind, name });
    }
  }
  return facts;
}

export function factsFromListing(listing) {
  return {
    // The listing cuts a name at 30 characters only where a picture follows it, and prints a group's
    // in full; the parse side is cut at 30 throughout, so this side is too.
    symbols: listing.symbols.map(x => ({ ...x, name: n30(x.name) })),
    xref: listing.xref.map(x => ({ ...x })),
    labels: listing.labels.map(x => ({ ...x })),
    // The listing prints an identifier call target as written; compare names case-insensitively.
    calls: listing.calls.map(x => ({ ...x, name: n28(x.name).toUpperCase() })),
  };
}

// A listing with one program names no program at all, so both sides drop the key rather than
// inventing one.
export function alignProgramKeys(facts, programNames) {
  if (!programNames || programNames.length > 1) return facts;
  for (const k of ['symbols', 'xref', 'labels', 'calls']) for (const r of facts[k]) r.prog = '';
  return facts;
}

export function multisetDiff(witness, mine, key) {
  const m = new Map();
  for (const x of witness) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  const matched = [];
  const onlyMine = [];
  for (const y of mine) {
    const list = m.get(key(y));
    if (list && list.length) matched.push([list.shift(), y]);
    else onlyMine.push(y);
  }
  return { matched, onlyWitness: [...m.values()].flat(), onlyMine };
}

// Unnamed FILLER items pair by size: one missing item would otherwise shift every later pair and
// report a cascade of size differences that are really one absence.
const symKey = (x) => `${x.prog}|${x.lvl}|${x.name}${x.name === 'FILLER' ? `|${x.size}` : ''}`;

export function compareFacts(witnessFacts, mineFacts) {
  const out = { symbols: {}, sizes: {}, labels: {}, calls: {}, xref: {}, samples: { symMissing: [], symExtra: [], sizeWrong: [], stateWrong: [], receivingMissed: [], receivingExtra: [], labelMissing: [], labelExtra: [], callMissing: [], callExtra: [] } };
  const sd = multisetDiff(witnessFacts.symbols, mineFacts.symbols, symKey);
  out.symbols = { witness: witnessFacts.symbols.length, mine: mineFacts.symbols.length, matched: sd.matched.length };
  let sizeCompared = 0;
  let sizeAgree = 0;
  for (const [w, m] of sd.matched) {
    if (w.size == null) continue;
    sizeCompared++;
    if (w.size === m.size) sizeAgree++;
    else out.samples.sizeWrong.push({ name: w.name, lvl: w.lvl, witness: w.size, mine: m.size, section: m.section });
  }
  out.sizes = { compared: sizeCompared, agree: sizeAgree };
  out.samples.symMissing = sd.onlyWitness;
  out.samples.symExtra = sd.onlyMine;

  const ld = multisetDiff(witnessFacts.labels, mineFacts.labels, x => `${x.prog}|${x.kind}|${x.name}`);
  out.labels = { witness: witnessFacts.labels.length, mine: mineFacts.labels.length, matched: ld.matched.length };
  out.samples.labelMissing = ld.onlyWitness;
  out.samples.labelExtra = ld.onlyMine;

  const cd = multisetDiff(witnessFacts.calls, mineFacts.calls, x => `${x.prog}|${x.kind}|${x.name}`);
  out.calls = { witness: witnessFacts.calls.length, mine: mineFacts.calls.length, matched: cd.matched.length };
  out.samples.callMissing = cd.onlyWitness;
  out.samples.callExtra = cd.onlyMine;

  // Items that share a name pair by the line that defines them first, so two records with the same
  // fields do not have one record's field compared with the other's; the rest pair in order.
  const byLine = multisetDiff(witnessFacts.xref, mineFacts.xref, x => `${x.prog}|${x.name}|${x.line ?? ''}`);
  const byName = multisetDiff(byLine.onlyWitness, byLine.onlyMine, x => `${x.prog}|${x.name}`);
  const xd = { matched: [...byLine.matched, ...byName.matched], onlyWitness: byName.onlyWitness, onlyMine: byName.onlyMine };
  let stateAgree = 0;
  let witnessReceiving = 0;
  let witnessReceivingCaught = 0;
  let mineOnlyReceiving = 0;
  let mineOnlyUnexplained = 0;
  for (const [w, m] of xd.matched) {
    if (w.state === m.state) stateAgree++;
    else out.samples.stateWrong.push({ name: w.name, witness: w.state, mine: m.state });
    if (w.state === 'refs' && m.state === 'refs') {
      if (w.receiving) { witnessReceiving++; if (m.receiving) witnessReceivingCaught++; else out.samples.receivingMissed.push({ name: w.name, verbs: m.verbs }); }
      if (!w.receiving && m.receiving) {
        mineOnlyReceiving++;
        if (!(m.via || '').split(',').every(v => WITNESS_NEVER_MARKS.has(v))) { mineOnlyUnexplained++; out.samples.receivingExtra.push({ name: w.name, via: m.via }); }
      }
    }
  }
  out.xref = { witness: witnessFacts.xref.length, matched: xd.matched.length, stateAgree, witnessReceiving, witnessReceivingCaught, mineOnlyReceiving, mineOnlyUnexplained };
  return out;
}
