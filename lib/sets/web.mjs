// SPDX-License-Identifier: AGPL-3.0-or-later
// What a CICS program says about its own HTTP response, and what it leaves unsaid.
//
// Every other rule set here asks where a value came from. These two ask what is absent: a cookie
// written without the attributes that keep it off a cleartext hop, and an HTML response sent without
// the headers that decide who may frame it or reinterpret its type. Absence needs no taint, no
// graph and no parser beyond the one that already reads EXEC CICS, which is why these are the first
// two rules of the twelve in docs/spec/z-sibling-rules.md.
//
// They are siblings of eleven published defects - CVE-2022-34307, CVE-2022-34311, CVE-2022-34313,
// CVE-2023-33847, CVE-2023-33849, CVE-2023-38363 for the cookie; CVE-2022-34162, CVE-2022-34318,
// CVE-2022-34329, CVE-2022-33955, CVE-2022-38705 for the headers. IBM shipped each of them in a
// product; a customer program that writes its own headers can ship every one of them again, and
// nothing looks.
//
// The unit is the program, not the statement. A header written in one paragraph protects a response
// sent in another, so a response is judged against every header the same program writes. That is
// deliberately generous: the failure worth avoiding is telling someone their response is unprotected
// when the header is eight paragraphs up.
import { inScope, isProgram, relPath } from '../sources.mjs';
import { parseCsd } from '../csd.mjs';
import { classify } from './log.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';


export const WEB_RULES = {
  'web-cookie-without-secure-attributes': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-1004',
    text: 'A program sets a cookie without the attributes that keep it off a cleartext hop',
    impact: 'A cookie is set without Secure/HttpOnly/SameSite, so it can cross the network in cleartext or be read by script',
    remedy: 'Set Secure, HttpOnly and SameSite on the Set-Cookie header the program writes',
  },
  'web-response-without-protective-headers': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-1021',
    text: 'A program sends HTML without the headers that say who may frame or reinterpret it',
    impact: "An HTML response goes out without Content-Security-Policy, X-Frame-Options or X-Content-Type-Options, leaving the browser's defaults to decide who may frame or script it",
    remedy: 'Write Content-Security-Policy, X-Frame-Options and X-Content-Type-Options headers on the HTML response (or have the front-end proxy add them, declared in cobolwork.site.json)',
  },
  'web-response-tells-the-caller-what-it-runs': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-200',
    text: 'A program writes a header naming the software behind it',
    impact: 'The response carries a Server, X-Powered-By or version header, so anyone asking for a page learns which product and level to look up advisories for before trying anything',
    remedy: 'Do not write the header, or write a value that names nothing: the client does not need it and the advisory record is public',
  },
  'web-uri-carries-a-credential': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-598',
    text: 'A program puts a credential in a URI rather than in the request body',
    impact: 'A query string is written to every proxy log, browser history and Referer header it passes, so the credential outlives the request in places nobody is watching',
    remedy: 'Send the credential in the body of a POST, or in an Authorization header, and never in the path or query of a URI',
  },
  'web-request-changes-state-without-a-token': {
    sev: 'med', evidence: 'advisory', cwe: 'CWE-352',
    text: 'A program changes state on a web request without comparing anything the browser could not forge',
    impact: 'Any page the user visits can make their browser send this request with their credentials attached, and the program will act on it',
    remedy: 'Compare a token the program generated and stored against one the request carries, and refuse the change when they differ',
  },
  'cics-listener-accepts-cleartext': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-319',
    text: 'A CICS listener accepts connections without TLS',
    impact: 'The TCPIPSERVICE takes connections on a port with SSL off, so everything the session carries - the 3270 data stream, a SOAP body, a credential on a sign-on screen - crosses the network in the clear and can be read or changed in flight',
    remedy: 'Set SSL(YES) and name a certificate on the TCPIPSERVICE, or front it with a TLS-terminating proxy the estate controls and restrict the port to that proxy',
  },
  'web-client-opens-cleartext': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-319',
    text: 'A program opens an outbound HTTP connection without TLS',
    impact: 'WEB OPEN asks for HTTP rather than HTTPS, so the request the program sends and the response it reads cross the network in the clear, readable and changeable in flight, unless an AT-TLS policy outside the program encrypts them',
    remedy: 'Open the connection with HTTPS, or through a client URIMAP with SCHEME(HTTPS); where AT-TLS secures it, use a URIMAP with ATTLS(AWARE) so the program fails rather than send in the clear',
  },
  'web-receive-length-exceeds-area': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-805',
    text: 'A web receive lets CICS write more bytes than the area it writes into',
    impact: 'CICS copies up to MAXLENGTH bytes of the body into the INTO area, so a body longer than the area, which the other end of the connection chooses, overwrites the storage after it',
    remedy: 'Pass a MAXLENGTH no greater than the INTO area, or LENGTH OF that area',
  },
  'web-link-opens-without-noopener': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-1022',
    text: 'A program writes a link that opens a new window with a handle back to this one',
    impact: 'A target=_blank link is emitted without rel=noopener, so the opened page can reach back into the opener (reverse tabnabbing)',
    remedy: 'Add rel="noopener" (and noreferrer) to any target="_blank" link the program emits',
  },
};

// Reading an option's operand out of an EXEC block, the same way lib/sets/cics.mjs does.
function execOptions(exec) {
  const opts = new Map();
  const words = [];
  const toks = exec.toks;
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.t !== 'word') continue;
    words.push(t.u);
    if (toks[i + 1] && toks[i + 1].t === 'sep' && toks[i + 1].v === '(') {
      const inner = [];
      let depth = 1;
      for (let k = i + 2; k < toks.length && depth > 0; k++) {
        if (toks[k].t === 'sep') { depth += toks[k].v === '(' ? 1 : -1; if (depth === 0) break; continue; }
        inner.push(toks[k]);
      }
      if (!opts.has(t.u)) opts.set(t.u, inner);
    }
  }
  return { opts, words };
}

// The options written outside any parentheses, which is where a CVDA keyword such as HTTP or HTTPS
// stands; a word inside an operand is a data name.
function keywords(exec) {
  const out = new Set();
  let depth = 0;
  for (const t of exec.toks) {
    if (t.t === 'sep') depth += t.v === '(' ? 1 : t.v === ')' ? -1 : 0;
    else if (t.t === 'word' && depth === 0) out.add(t.u);
  }
  return out;
}

// A header name or value is only knowable when the program wrote it as a literal. NAME(WS-HDR-NAME)
// names a field whose contents this rule set cannot see, and a rule that guessed would be inventing
// evidence, so the statement is counted as unreadable and reported as coverage, not as a pass.
const literalOf = (toks) => {
  if (!toks || !toks.length) return null;
  const lit = toks.find((t) => t.t === 'lit');
  return lit ? String(lit.v) : null;
};

const PROTECTIVE = [
  { header: /^content-security-policy$/i, why: 'which script and frame sources the browser may load' },
  { header: /^x-frame-options$/i, why: 'who may put this response in a frame' },
  { header: /^x-content-type-options$/i, why: 'whether the browser may re-sniff the type' },
  // A back-and-refresh attack replays a page the browser kept. CVE-2022-33955 is that shape.
  { header: /^cache-control$/i, why: 'whether the browser may keep this page after the session ends' },
];

// What makes a response HTML, and so worth asking these questions about. A response with a media
// type the program chose and that is not markup - a JSON payload, a CSV extract - is not framed,
// not sniffed into script, and carries no links.
const MARKUP = /(text\/html|application\/xhtml|text\/xml|application\/xml)/i;

// A header whose value names the software answering. The absence of a protective header is one
// finding; the presence of an informative one is the other, and it is the same statement.
const TELLS = /^(server|x-powered-by|x-aspnet-version|x-generator|via)$/i;
// A URI that carries a credential in its query or path. Written as a literal, or built by a
// STRING from a field whose name says what it holds - lib/sets/log.mjs already judges the name.
const CREDENTIAL_PARAM = /[?&/][a-z0-9_-]*(password|passwd|pwd|token|apikey|api_key|secret|credential)[a-z0-9_-]*=/i;

// What a request can make a program change: a file record, a row, or a transaction started. A
// temporary-storage queue is where a web program keeps its own conversation, so it is not counted.
function stateChange(e) {
  const w = e.toks.filter((t) => t.t === 'word').map((t) => t.u);
  if (e.kind === 'SQL') return ['UPDATE', 'INSERT', 'DELETE', 'MERGE'].includes(w[0]) ? `EXEC SQL ${w[0]}` : null;
  if (e.kind !== 'CICS') return null;
  if (['WRITE', 'REWRITE', 'DELETE'].includes(w[0]) && ['FILE', 'DATASET'].includes(w[1])) return `EXEC CICS ${w[0]} ${w[1]}`;
  if (w[0] === 'START' && w.includes('TRANSID')) return 'EXEC CICS START TRANSID';
  return null;
}
const CONDITION_VERBS = new Set(['IF', 'EVALUATE', 'WHEN']);
// A WHEN's statement runs to the next verb; its condition is the few words after it.
const WHEN_WINDOW = 12;
const CONDITION_WORDS = new Set(['IS', 'NOT', 'EQUAL', 'EQUALS', 'TO', 'THAN', 'GREATER', 'LESS', 'AND', 'OR', 'THEN', 'OF', 'IN', 'TRUE', 'FALSE', 'ALSO', 'OTHER', 'ANY']);
const FIGURATIVE = /^(SPACES?|ZEROS?|ZEROES|LOW-VALUES?|HIGH-VALUES?|NULLS?|QUOTES?)$/;
const TOKEN_WORDS = new Set(['TOKEN', 'NONCE', 'CSRF', 'ANTIFORGERY', 'XSRF']);
const namesToken = (t) => String(t.u).split('-').some((w) => TOKEN_WORDS.has(w));
const HTTP_METHOD = /^(GET|POST|PUT|PATCH|DELETE)$/i;

// A definition that says nothing about SSL accepts cleartext, because CICS defaults it to NO. So
// the absence and the explicit NO are one finding, and PROTOCOL only changes what is in the clear.
const encrypted = (svc) => /^(YES|CLIENTAUTH|CLIENTCERT)$/i.test(String(svc.ssl || ''));

export function scanWeb(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const files = all.filter(isProgram);
  const findings = [];
  const stats = {
    filesScanned: 0, filesUnreadable: 0, filesUnparsed: 0,
    webPrograms: 0, headersWritten: 0, headersComputed: 0, htmlResponses: 0, listenersDefined: 0,
    outboundOpens: 0, opensUndecided: 0,
  };
  const where = (x, path) => ({ path: x.file ? relPath(root, x.file) : path, line: x.line || 1 });

  function judge(p, path) {
    const headers = [];            // every WRITE HTTPHEADER this program issues
    const sends = [];              // every place it sends a response
    const cookies = [];
    let computedHeaders = 0;

    const opens = [];              // every outbound WEB OPEN, and what it says about TLS
    const receives = [];           // every receive into an area with a length it can be judged by
    const item = (name) => p.items.find((i) => i.name === name);
    // A variable naming a URIMAP or a host usually holds one literal from its VALUE clause.
    const valueOf = (toks) => {
      if (!toks || !toks.length) return null;
      const lit = literalOf(toks);
      if (lit !== null) return lit.trim();
      const it = toks[0].t === 'word' ? item(toks[0].u) : null;
      const v = it && it.values && it.values.find((x) => x.t === 'lit');
      return v ? String(v.v).trim() : null;
    };
    // MAXLENGTH as a literal, or LENGTH OF an item. A data item's value can change before the
    // command runs, so it is not judged.
    const lengthOf = (toks) => {
      if (!toks || !toks.length) return null;
      if (toks.length === 1 && (toks[0].t === 'num' || /^\d+$/.test(String(toks[0].v)))) return { bytes: Number(toks[0].v), written: String(toks[0].v) };
      if (toks.length >= 3 && toks[0].u === 'LENGTH' && toks[1].u === 'OF' && toks[2].t === 'word') {
        const it = item(toks[2].u);
        return it && it.size ? { bytes: it.size, written: `LENGTH OF ${toks[2].u}` } : null;
      }
      return null;
    };

    for (const e of p.execs) {
      if (e.kind !== 'CICS') continue;
      const { opts: o, words: w } = execOptions(e);
      if (!w.includes('WEB') && !w.includes('DOCUMENT')) continue;
      const at = where(e, path);

      if (w[0] === 'WEB' && w[1] === 'OPEN') {
        const k = keywords(e);
        // SCHEME(HTTPS) and SCHEME(DFHVALUE(HTTPS)) name the CVDA as the keyword does; any other
        // operand is a field whose value is set at run time.
        const named = (o.get('SCHEME') || []).map((t) => t.u);
        const cvda = named.length && named.every((x) => ['DFHVALUE', 'HTTP', 'HTTPS'].includes(x)) ? named.find((x) => x !== 'DFHVALUE') : null;
        opens.push({ at, https: k.has('HTTPS') || cvda === 'HTTPS', http: k.has('HTTP') || cvda === 'HTTP',
          urimap: o.has('URIMAP') ? valueOf(o.get('URIMAP')) : undefined, host: o.has('HOST') ? valueOf(o.get('HOST')) : null });
        continue;
      }
      if (w[0] === 'WEB' && (w[1] === 'RECEIVE' || w[1] === 'CONVERSE') && o.has('INTO')) {
        const into = o.get('INTO')[0];
        const area = into && into.t === 'word' ? item(into.u) : null;
        const max = lengthOf(o.get('MAXLENGTH'));
        if (area && area.size && max) receives.push({ at, verb: w[1], area: into.u, size: area.size, max });
      }

      if (w.includes('WRITE') && w.includes('HTTPHEADER')) {
        const name = literalOf(o.get('HTTPHEADER') || o.get('NAME'));
        const value = literalOf(o.get('VALUE'));
        if (name === null) { computedHeaders++; continue; }
        headers.push({ at, name, value });
        if (/^set-cookie$/i.test(name)) cookies.push({ at, name, value });
        continue;
      }

      // SEND and DOCUMENT RETRIEVE both put a response on the wire; CREATE and INSERT build the
      // document that one of them will send.
      if ((w.includes('SEND') || w.includes('CONVERSE')) && w.includes('WEB')) {
        const media = literalOf(o.get('MEDIATYPE'));
        sends.push({ at, media, html: media === null ? null : MARKUP.test(media) });
      }
    }

    // A document built with HTML in it is an HTML response even where the send never states a
    // media type, which is the common case: the media type defaults from the document template.
    //
    // The page is usually NOT built inside the EXEC CICS block. A COBOL program MOVEs and STRINGs
    // its markup into working storage and sends that, so reading only the command's own literals
    // misses the ordinary shape of a CICS web program. No corpus measurement could have caught
    // that: no public repository uses the CICS web API at all.
    const docText = [
      ...p.execs.filter((e) => e.kind === 'CICS').flatMap((e) => e.toks.filter((t) => t.t === 'lit').map((t) => String(t.v))),
      ...(p.statements || []).flatMap((st) => (st.literals || []).map((l) => String(l && l.v !== undefined ? l.v : l))),
    ].join('\n');
    const looksHtml = /<\s*(html|body|table|div|form|a\s|script)/i.test(docText);

    // A URI the program builds for an outbound call, or writes into its own page.
    const uris = [];
    for (const lit of docText.split(String.fromCharCode(10))) {
      if (CREDENTIAL_PARAM.test(lit)) uris.push(lit.trim().slice(0, 90));
    }
    // A credential-named field STRINGed into something: the name is the evidence, not the value.
    const built = [];
    for (const st of p.statements || []) {
      if (st.verb !== 'STRING') continue;
      for (const tok of st.sources || []) {
        if (tok.t !== 'word') continue;
        if (classify(tok.u) === 'credential') built.push({ name: tok.u, line: st.line || 1 });
      }
    }
    // A state change on a request from the web, and whether anything unforgeable guards it.
    const webRequest = p.execs.some((e) => {
      if (e.kind !== 'CICS') return false;
      const w = e.toks.filter((t) => t.t === 'word').map((t) => t.u);
      return w[0] === 'WEB' && (w[1] === 'RECEIVE' || w[1] === 'READ');
    });
    const changes = p.execs.map((e) => ({ e, what: stateChange(e) })).filter((c) => c.what);
    // A token counts where a condition compares it with another field: moved, displayed or tested
    // against SPACES, it verifies nothing.
    const conditions = (p.statements || []).filter((st) => CONDITION_VERBS.has(st.verb))
      .map((st) => (p.proc ? p.proc.tokens.slice(st.at + 1, st.end ?? st.at + 1 + WHEN_WINDOW) : []));
    const comparesToken = conditions.some((c) => {
      const words = c.filter((t) => t.t === 'word' && !CONDITION_WORDS.has(t.u) && !FIGURATIVE.test(t.u));
      return words.some(namesToken) && words.length >= 2;
    });
    const testsMethod = conditions.some((c) => c.some((t) => t.t === 'lit' && HTTP_METHOD.test(String(t.v).trim())));

    return { headers, sends, cookies, computedHeaders, docText, looksHtml, id: p.id, uris, built, webRequest, changes, comparesToken, testsMethod, opens, receives };
  }

  // The listener that accepts the request these responses answer. It is defined in a CSD rather
  // than in a program, so this reads every file the way lib/sets/priv.mjs does: a DFHCSDUP listing
  // is named whatever the estate named it, and filtering on an extension is how a BMS count once
  // came out as zero.
  // Client URIMAPs come from the same files: WEB OPEN URIMAP(name) takes its scheme from one.
  const urimaps = new Map();
  for (const f of all) {
    let src;
    try { src = tree.text(f).text; } catch { continue; }
    if (!/^\s*DEFINE\s+(TCPIPSERVICE|URIMAP)\s*\(/im.test(src)) continue;
    const path = relPath(root, f);
    const csd = parseCsd(src);
    for (const [name, u] of csd.urimaps) if (!urimaps.has(name)) urimaps.set(name, { ...u, path });
    for (const [name, svc] of csd.tcpipservices) {
      stats.listenersDefined++;
      if (encrypted(svc)) continue;
      const carries = svc.protocol ? `${/^[AEIOU]/i.test(svc.protocol) ? 'an' : 'a'} ${svc.protocol} ` : '';
      findings.push({
        rule: 'cics-listener-accepts-cleartext', path, line: svc.line,
        detail: `TCPIPSERVICE ${name} accepts ${carries}connection${svc.port ? ` on port ${svc.port}` : ''} with `
          + (svc.ssl ? `SSL(${svc.ssl})` : 'no SSL attribute, which CICS defaults to NO')
          + ', so everything the session carries crosses the network in the clear',
      });
    }
  }

  const run = eachWithinMemory(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    // The whole set is about EXEC CICS WEB and EXEC CICS DOCUMENT. Nothing else needs parsing.
    if (!/EXEC\s+CICS\s+(WEB|DOCUMENT)/i.test(src)) return src.length;
    let r;
    try { r = tree.parse(f, src); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    const path = relPath(root, f);

    for (const p of r.programs) {
      const v = judge(p, path);
      // Every signal this set reads, not only the ones it started with: a program that opens an
      // outbound session or answers a web request has said something worth judging even when it
      // writes no header and sends no page.
      const anything = v.headers.length || v.sends.length || v.cookies.length || v.looksHtml
        || v.uris.length || v.built.length || (v.webRequest && v.changes.length) || v.opens.length || v.receives.length;
      if (!anything) continue;
      stats.webPrograms++;

      for (const o of v.opens) {
        stats.outboundOpens++;
        const to = o.host ? ` to ${o.host}` : '';
        if (o.https) continue;
        if (o.http) {
          findings.push({ rule: 'web-client-opens-cleartext', ...o.at, program: v.id,
            detail: `${v.id} opens a connection${to} asking for HTTP rather than HTTPS, so what it sends and reads crosses the network in the clear unless an AT-TLS policy outside the program encrypts it` });
          continue;
        }
        const u = o.urimap ? urimaps.get(o.urimap.toUpperCase()) : null;
        if (u && /^HTTP$/i.test(u.scheme || '') && !/^AWARE$/i.test(u.attls || '')) {
          findings.push({ rule: 'web-client-opens-cleartext', ...o.at, program: v.id,
            detail: `${v.id} opens a connection through URIMAP ${o.urimap.toUpperCase()}, which ${u.path}:${u.line} defines with SCHEME(HTTP)${u.host ? ` to ${u.host}` : ''} and no ATTLS(AWARE), so what it sends and reads crosses the network in the clear unless an AT-TLS policy encrypts it` });
          continue;
        }
        // A scheme in a variable, or a URIMAP the tree does not define, is decided where this cannot see.
        if (!u || !u.scheme) stats.opensUndecided++;
      }

      for (const r of v.receives) {
        if (r.max.bytes <= r.size) continue;
        findings.push({ rule: 'web-receive-length-exceeds-area', ...r.at, program: v.id,
          detail: `${v.id} has WEB ${r.verb} pass up to MAXLENGTH(${r.max.written}), ${r.max.bytes} bytes, into ${r.area}, which is ${r.size} bytes` });
      }
      stats.headersWritten += v.headers.length;
      stats.headersComputed += v.computedHeaders;

      for (const c of v.cookies) {
        // A Set-Cookie whose value the program computed is unreadable, not safe.
        if (c.value === null) { stats.headersComputed++; continue; }
        const missing = [];
        if (!/;\s*secure\b/i.test(c.value)) missing.push('Secure');
        if (!/;\s*httponly\b/i.test(c.value)) missing.push('HttpOnly');
        if (!/;\s*samesite\s*=/i.test(c.value)) missing.push('SameSite');
        if (!missing.length) continue;
        findings.push({
          rule: 'web-cookie-without-secure-attributes', ...c.at, program: v.id,
          detail: `${v.id} writes Set-Cookie without ${missing.join(', ')}`
            + (missing.includes('Secure') ? ', so the browser will send this cookie over a cleartext hop' : ''),
        });
      }

      for (const h of v.headers.filter((x) => TELLS.test(x.name))) {
        findings.push({
          rule: 'web-response-tells-the-caller-what-it-runs', ...h.at, program: v.id,
          detail: `${v.id} writes the header ${h.name}${h.value ? ` with the value '` + h.value + `'` : ''}, which names the software answering rather than anything the client needs`,
        });
      }
      // One per program: a URI literal and the field STRINGed into it are the same credential in
      // the same place, and the STRING carries the line worth reading.
      const credInUri = v.built.length
        ? { line: v.built[0].line, why: 'STRINGs ' + v.built[0].name + ' into a value it sends, and the name says it holds a credential' }
        : (v.uris.length ? { line: 1, why: 'builds a URI whose query names a credential: ' + v.uris[0] } : null);
      if (credInUri) {
        findings.push({
          rule: 'web-uri-carries-a-credential', path, line: credInUri.line, program: v.id,
          detail: v.id + ' ' + credInUri.why,
        });
      }
      if (v.webRequest && v.changes.length && !v.comparesToken) {
        const what = [...new Set(v.changes.map((c) => c.what))];
        findings.push({
          rule: 'web-request-changes-state-without-a-token', ...where(v.changes[0].e, path), program: v.id,
          detail: `${v.id} changes state (${what.slice(0, 3).join(', ')}${what.length > 3 ? ', …' : ''}) on a request it received from the web and compares no token with another field`
            + (v.testsMethod ? '; it tests the HTTP method, which a forged request sets too' : '')
            + '; nothing here follows a token checked in another program reached by LINK, so that is what this could not rule out',
        });
      }
      const html = v.sends.filter((s) => s.html === true).length > 0 || (v.looksHtml && v.sends.length > 0);
      if (!html) continue;
      stats.htmlResponses++;
      const at = (v.sends.find((s) => s.html === true) || v.sends[0]).at;

      const absent = PROTECTIVE.filter((h) => !v.headers.some((x) => h.header.test(x.name)));
      // A program that wrote none of the three has said nothing about any of this; one that wrote
      // two of three made a choice about the third. Both are reported, and the detail says which.
      if (absent.length) {
        findings.push({
          rule: 'web-response-without-protective-headers', ...at, program: v.id,
          detail: `${v.id} sends HTML and writes no ${absent.map((h) => h.header.source.replace(/[^a-z-]/gi, '')).join(', no ')} header`
            + (v.computedHeaders ? `. ${v.computedHeaders} header name or value in this program is computed, so what it sets was not read` : ''),
        });
      }

      // rel="noopener" is the response's own text, not a header, so it is read from the literals
      // the document is built from.
      for (const m of v.docText.matchAll(/<a\b[^>]*target\s*=\s*["']?_blank[^>]*>/gi)) {
        if (/\brel\s*=\s*["'][^"']*noopener/i.test(m[0])) continue;
        findings.push({
          rule: 'web-link-opens-without-noopener', ...at, program: v.id,
          detail: `${v.id} writes a link with target="_blank" and no rel="noopener", so the page it opens can navigate this one`,
        });
        break;                    // one per program: the fix is the same edit wherever it appears
      }
    }
    r = null;
    return src.length;
  }, { label: 'web', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('web', { rules: WEB_RULES, findings, stats, run });
}
