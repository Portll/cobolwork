// SPDX-License-Identifier: AGPL-3.0-or-later
// The screen every MVS 3.8j member passes before it is admitted to a corpus: a member carrying an
// IBM notice or a program number beside a rights word is out. 'COPYRIGHT = NONE' is not a notice.
const IBM_NOTICE = /\bPROPERTY\s+OF\s+IBM\b|\bRESTRICTED\s+MATERIALS?\s+OF\s+IBM\b|\bLICENSED\s+MATERIALS?\s*-\s*PROGRAM\s+PROPERTY\b|\bCOPYRIGHT\s+(?:\(C\)\s*)?(?:IBM|INTERNATIONAL\s+BUSINESS\s+MACHINES)\b|\b(?:IBM|INTERNATIONAL\s+BUSINESS\s+MACHINES)\s+CORP(?:ORATION|\.)?,?\s+(?:19|20)\d\d\b|\(C\)\s*(?:COPYRIGHT\s+)?IBM\b|\bCOPYRIGHT\b.{0,40}\bIBM\s+(?:UK|UNITED\s+KINGDOM|DEUTSCHLAND|FRANCE|JAPAN|CANADA|AUSTRALIA|WORLD\s+TRADE)\b/i;
const PROGRAM_NUMBER_NOTICE = /\b5[67]\d\d-[A-Z0-9]{3}\b.{0,80}\b(?:COPYRIGHT|LICENSED|PROPERTY)\b|\b(?:COPYRIGHT|LICENSED|PROPERTY)\b.{0,80}\b5[67]\d\d-[A-Z0-9]{3}\b/i;
const SEQUENCE = /^\s*(?:[A-Z0-9$#@]{1,8}|FILE\s+\d{1,4})?\s*$/i;

// Sequence columns and comment rules go first, so a notice broken across cards still matches.
function flatten(text) {
  return text.split(/\r?\n/).map((line) => {
    const card = line.length > 72 && SEQUENCE.test(line.slice(72)) ? line.slice(0, 72) : line;
    return card.replace(/\/\*|\*\/|^\s*\/\/\*|^\s*\.\*/g, ' ').replace(/[*|]+/g, ' ');
  }).join(' ').replace(/\s+/g, ' ');
}

export function noticeIn(text) {
  const flat = flatten(text);
  const m = IBM_NOTICE.exec(flat) || PROGRAM_NUMBER_NOTICE.exec(flat);
  return m ? flat.slice(Math.max(0, m.index - 60), m.index + 100).trim() : null;
}
