// SPDX-License-Identifier: AGPL-3.0-or-later
// EXEC SQL as Db2 reads it, whichever language embeds it: a statement's words, host variables and
// literals, and which host variables it reads and which it writes.
// The words, host variables and literals of a statement. A host variable is :NAME, qualified as
// :GROUP.NAME, and may carry an indicator variable, :NAME:IND or :NAME INDICATOR :IND.
export function sqlTokens(sql) {
  const toks = [];
  const re = /'(?:[^']|'')*'|"(?:[^"]|"")*"|:\s*[A-Z0-9_$#@-]+(?:\.[A-Z0-9_$#@-]+)*|[A-Z0-9_$#@-]+|[(),=<>+*/;.]/gi;
  for (const m of sql.matchAll(re)) {
    const t = m[0];
    if (t.startsWith(':')) toks.push({ host: t.slice(1).trim().toUpperCase() });
    else if (/^['"]/.test(t)) toks.push({ lit: t });
    else toks.push({ word: t.toUpperCase() });
  }
  return toks;
}

// Clauses that end an INTO list.
const AFTER_INTO = new Set(['FROM', 'WHERE', 'GROUP', 'HAVING', 'ORDER', 'FETCH', 'FOR', 'WITH', 'OPTIMIZE', 'QUERYNO', 'SKIP', 'UNION', 'USING', 'VALUES']);

// Which host variables a statement reads and which it writes, as Db2's SQL reference gives them. A
// variable both read and written is in both lists. INTO a host variable writes it (INSERT INTO and
// MERGE INTO name a table); so do SET's targets, GET DIAGNOSTICS' and ASSOCIATE LOCATORS' list. A
// procedure's argument that is a lone variable may be IN, OUT or INOUT, which only the server knows.
export function sqlRoles(toks) {
  const sending = [];
  const receiving = [];
  const read = (h) => { if (!sending.includes(h)) sending.push(h); };
  const write = (h) => { if (!receiving.includes(h)) receiving.push(h); };
  const verb = toks.find((t) => t.word)?.word;
  if (verb === 'CALL') return callRoles(toks, read, write), { sending, receiving };
  // DESCRIBE and PREPARE read the SQLDA's SQLN and write the rest of it.
  const intoBoth = verb === 'DESCRIBE' || verb === 'PREPARE';
  let into = false;
  let assigning = verb === 'SET';
  let depth = 0;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    const next = toks[i + 1];
    if (t.word === '(') depth++;
    else if (t.word === ')') depth--;
    else if (verb === 'SET' && t.word === '=' && depth === 0) assigning = false;
    else if (verb === 'SET' && t.word === ',' && depth === 0) assigning = true;
    if (t.word === 'INTO' && next && (next.host || next.word === 'DESCRIPTOR')) { into = true; continue; }
    if (into && t.word && AFTER_INTO.has(t.word)) into = false;
    if (t.word === 'DESCRIPTOR' && next?.host) {
      // FETCH ... INTO DESCRIPTOR and USING DESCRIPTOR are synonyms: the program fills the SQLDA and Db2 writes where it points.
      if (verb === 'FETCH' || intoBoth) { read(next.host); write(next.host); } else read(next.host);
      i++;
      continue;
    }
    if (!t.host) continue;
    const written = into || assigning
      || (verb === 'GET' && next?.word === '=')
      || (verb === 'ASSOCIATE' && !toks.slice(0, i).some((x) => x.word === 'WITH'));
    if (!written || (into && intoBoth)) read(t.host);
    if (written) write(t.host);
  }
  return { sending, receiving };
}

// CALL :name reads the name. Each argument that is a lone variable, with or without its indicator,
// is read and may be written; any other argument is an expression, IN only.
function callRoles(toks, read, write) {
  let depth = 0;
  let arg = [];
  const close = () => {
    const hosts = arg.filter((t) => t.host);
    const lone = hosts.length && arg.every((t) => t.host || t.word === 'INDICATOR');
    for (const h of hosts) { read(h.host); if (lone) write(h.host); }
    arg = [];
  };
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i];
    if (t.word === 'DESCRIPTOR' && toks[i + 1]?.host) { read(toks[i + 1].host); write(toks[i + 1].host); i++; continue; }
    if (t.word === '(') { if (depth++ > 0) arg.push(t); continue; }
    if (t.word === ')') { if (--depth > 0) arg.push(t); else close(); continue; }
    if (depth === 0) { if (t.host) read(t.host); continue; }
    if (depth === 1 && t.word === ',') { close(); continue; }
    arg.push(t);
  }
}

export function hostVariableRoles(sql) {
  return sqlRoles(sqlTokens(sql));
}

// The host variables in a parsed EXEC SQL block: a colon, then a name qualified by joined periods as
// :GROUP.FIELD. Each carries its path, the token naming the item, where it stands, and whether the
// statement writes it by sqlRoles.
export function hostVariablesIn(toks) {
  const found = [];
  const sql = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t === 'op' && t.v === ':' && toks[k + 1] && toks[k + 1].t === 'word') {
      const path = [toks[k + 1]];
      let j = k + 2;
      for (; j + 1 < toks.length && toks[j].t === 'period' && toks[j].joined && toks[j + 1].t === 'word'; j += 2) path.push(toks[j + 1]);
      const host = path.map((p) => p.u).join('.');
      found.push({ path, tok: path[path.length - 1], at: k + 1, host });
      sql.push({ host });
      k = j - 1;
      continue;
    }
    sql.push(t.t === 'lit' ? { lit: t.v } : { word: String(t.u ?? t.v).toUpperCase() });
  }
  const { receiving } = sqlRoles(sql);
  return found.map((h) => ({ ...h, written: receiving.includes(h.host) }));
}
