// SPDX-License-Identifier: AGPL-3.0-or-later
// Where a parsed source uses the language elements IBM's Enterprise COBOL Language Reference lists
// as obsolete (Appendixes, "Obsolete language elements"): each occurrence with the rule it falls
// under, the token it was read from, and the word to name it by.
const WORD = (t, u) => !!t && t.t === 'word' && t.u === u;
const ID_PARAGRAPHS = new Set(['AUTHOR', 'INSTALLATION', 'DATE-WRITTEN', 'DATE-COMPILED', 'SECURITY']);
const DIVISIONS = { IDENTIFICATION: 'id', ID: 'id', ENVIRONMENT: 'env', DATA: 'data', PROCEDURE: 'proc' };
const DATA_SECTIONS = new Set(['FILE', 'WORKING-STORAGE', 'LOCAL-STORAGE', 'LINKAGE', 'SCREEN', 'REPORT', 'COMMUNICATION']);
const isNumber = (t) => !!t && (t.t === 'num' || (t.t === 'word' && /^[+-]?\d+$/.test(t.v)));
const FIGURATIVE = new Set(['SPACE', 'SPACES', 'ZERO', 'ZEROS', 'ZEROES', 'QUOTE', 'QUOTES', 'HIGH-VALUE', 'HIGH-VALUES', 'LOW-VALUE', 'LOW-VALUES', 'NULL', 'NULLS']);

// `tokens` is a source's whole token list; `programs` its parsed programs. Returns
// [{ rule, tok, item }] in token order, statement-level elements from each program's statements.
export function obsoleteIn(tokens, programs) {
  const out = [];
  let division = null;
  let sentenceStart = true;
  let inFd = false;
  let inUse = null;
  for (let k = 0; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.t === 'period') { sentenceStart = true; inFd = false; inUse = null; continue; }
    if (t.t !== 'word') { sentenceStart = false; continue; }
    const next = tokens[k + 1];
    const start = sentenceStart;
    sentenceStart = false;
    if (WORD(next, 'DIVISION') && DIVISIONS[t.u]) { division = DIVISIONS[t.u]; continue; }
    if ((t.u === 'PROGRAM-ID' || t.u === 'FUNCTION-ID') && division !== 'id') { division = 'id'; continue; }
    if (t.u === 'END' && (WORD(next, 'PROGRAM') || WORD(next, 'FUNCTION'))) { division = null; continue; }
    if (start && DATA_SECTIONS.has(t.u) && WORD(next, 'SECTION') && division !== 'proc') { division = 'data'; continue; }
    if (division === 'id') {
      if (start && ID_PARAGRAPHS.has(t.u) && next && next.t === 'period') out.push({ rule: 'obsolete-identification-paragraph', tok: t, item: t.u });
    } else if (division === 'env') {
      if (t.u === 'MEMORY' && (WORD(next, 'SIZE') || isNumber(next))) out.push({ rule: 'obsolete-memory-size', tok: t, item: 'MEMORY SIZE' });
      else if (t.u === 'MULTIPLE' && WORD(next, 'FILE')) out.push({ rule: 'obsolete-multiple-file-tape', tok: t, item: 'MULTIPLE FILE TAPE' });
      else if (t.u === 'RERUN') out.push({ rule: 'obsolete-rerun', tok: t, item: 'RERUN' });
    } else if (division === 'data') {
      if (start && (t.u === 'FD' || t.u === 'SD')) { inFd = true; continue; }
      if (!inFd) continue;
      if (t.u === 'LABEL' && (WORD(next, 'RECORD') || WORD(next, 'RECORDS'))) out.push({ rule: 'obsolete-label-records', tok: t, item: 'LABEL RECORDS' });
      else if (t.u === 'VALUE' && WORD(next, 'OF')) out.push({ rule: 'obsolete-value-of', tok: t, item: 'VALUE OF' });
      else if (t.u === 'DATA' && (WORD(next, 'RECORD') || WORD(next, 'RECORDS'))) out.push({ rule: 'obsolete-data-records', tok: t, item: 'DATA RECORDS' });
    } else if (division === 'proc') {
      if (start && t.u === 'USE') inUse = t;
      if (inUse && t.u === 'DEBUGGING') { out.push({ rule: 'obsolete-debugging-declarative', tok: inUse, item: 'USE FOR DEBUGGING' }); inUse = null; }
      else if (t.u === 'DEBUG-ITEM') out.push({ rule: 'obsolete-debugging-declarative', tok: t, item: 'DEBUG-ITEM' });
      else if (t.u === 'ENTER') out.push({ rule: 'obsolete-enter', tok: t, item: 'ENTER' });
      else if (t.u === 'REVERSED') out.push({ rule: 'obsolete-reversed', tok: t, item: 'REVERSED' });
    }
  }
  for (const p of programs) {
    if (!p.proc) continue;
    const toks = p.proc.tokens;
    for (const l of p.labels) if (l.kind === 'S' && l.at != null && WORD(toks[l.at + 1], 'SECTION') && isNumber(toks[l.at + 2])) out.push({ rule: 'obsolete-segment-number', tok: toks[l.at + 2], item: l.name, segment: Number(toks[l.at + 2].v) });
    for (const st of p.statements) {
      if (st.at == null) continue;
      const seg = toks.slice(st.at + 1, st.end);
      const verb = toks[st.at];
      if (st.verb === 'ALTER') out.push({ rule: 'obsolete-alter', tok: verb, item: 'ALTER' });
      else if (st.verb === 'GO' && !seg.some((x) => x.t === 'word' && x.u !== 'TO')) out.push({ rule: 'obsolete-go-to-without-name', tok: verb, item: 'GO TO' });
      else if (st.verb === 'STOP' && seg[0] && (seg[0].t === 'lit' || isNumber(seg[0]) || (seg[0].t === 'word' && FIGURATIVE.has(seg[0].u)))) out.push({ rule: 'obsolete-stop-literal', tok: verb, item: 'STOP literal' });
    }
  }
  return out;
}
