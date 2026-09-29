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
  };
  const where = (x, path) => ({ path: x.file ? relPath(root, x.file) : path, line: x.line || 1 });

  function judge(p, path) {
    const headers = [];            // every WRITE HTTPHEADER this program issues
    const sends = [];              // every place it sends a response
    const cookies = [];
    let computedHeaders = 0;

    for (const e of p.execs) {
      if (e.kind !== 'CICS') continue;
      const { opts: o, words: w } = execOptions(e);
      if (!w.includes('WEB') && !w.includes('DOCUMENT')) continue;
      const at = where(e, path);

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
    const changes = p.execs.filter((e) => {
      if (e.kind !== 'CICS') return false;
      const w = e.toks.filter((t) => t.t === 'word').map((t) => t.u);
      return ['WRITE', 'REWRITE', 'DELETE'].includes(w[0]) && ['FILE', 'DATASET'].includes(w[1]);
    });
    const tokenWords = new Set(['TOKEN', 'NONCE', 'CSRF', 'ANTIFORGERY', 'XSRF']);
    const comparesToken = (p.statements || []).some((st) => (st.sources || [])
      .some((t) => t.t === 'word' && String(t.u).split('-').some((w) => tokenWords.has(w))));

    return { headers, sends, cookies, computedHeaders, docText, looksHtml, id: p.id, uris, built, webRequest, changes, comparesToken };
  }

  // The listener that accepts the request these responses answer. It is defined in a CSD rather
  // than in a program, so this reads every file the way lib/sets/priv.mjs does: a DFHCSDUP listing
  // is named whatever the estate named it, and filtering on an extension is how a BMS count once
  // came out as zero.
  for (const f of all) {
    let src;
    try { src = tree.text(f).text; } catch { continue; }
    if (!/^\s*DEFINE\s+TCPIPSERVICE\s*\(/im.test(src)) continue;
    const path = relPath(root, f);
    for (const [name, svc] of parseCsd(src).tcpipservices) {
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
        || v.uris.length || v.built.length || (v.webRequest && v.changes.length);
      if (!anything) continue;
      stats.webPrograms++;
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
        findings.push({
          rule: 'web-request-changes-state-without-a-token', ...where(v.changes[0], path), program: v.id,
          detail: `${v.id} changes state on a request it received from the web and compares no token; nothing here follows a token checked in another program reached by LINK, so that is what this could not rule out`,
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
