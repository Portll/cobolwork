// SPDX-License-Identifier: AGPL-3.0-or-later
// Credentials written into COBOL source. The shapes are the ones rules/gitleaks-mainframe.toml gives
// gitleaks, read from that file, so one list serves both and the build gate does not depend on
// gitleaks being installed. Go's RE2 syntax is taken only where it means the same in JavaScript; any
// other construct is refused when the file is read.
import { readFileSync } from 'node:fs';
import { inScope, isProgram, isCopybook, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread } from '../kernel/source-tree.mjs';
import { drive, loopOver } from '../kernel/shared-pass.mjs';

export const SECRETS_RULES = {
  'credential-in-source': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-798', measured: false,
    text: 'A credential is written into the source',
    impact: 'Everyone who can read the source, its history or a listing can sign on with it, and changing it means changing and redeploying the program',
    remedy: 'Read the credential at run time from where the site keeps them (a RACF-protected data set, a PassTicket, a Db2 trusted context or a CICS-supplied identity), and change the one already exposed',
  },
};

// The TOML ids of the shapes that occur in COBOL programs and copybooks, and how a finding names each.
const SHAPES = {
  'cobol-value-credential': (m) => `${dataName(m) || 'a data item named for a credential'} has a literal VALUE`,
  'embedded-sql-connect-password': () => 'EXEC SQL CONNECT gives a literal password',
  'cics-signon-password': (m) => `EXEC CICS ${/\b(SIGNON|VERIFY|CHANGE)\b/i.exec(m)[1].toUpperCase()} gives a literal PASSWORD`,
  'cics-new-password': (m) => `EXEC CICS ${/\b(SIGNON|CHANGE)\b/i.exec(m)[1].toUpperCase()} gives a literal NEWPASSWORD`,
};

const dataName = (m) => (/\b(?:0?[1-9]|[1-4][0-9]|77)\s+([A-Z0-9][A-Z0-9-]*)/i.exec(m) || [])[1]?.toUpperCase();

const value = (raw) => {
  const t = raw.trim();
  if (t.startsWith("'''")) return t.slice(3, t.lastIndexOf("'''"));
  if (t.startsWith('"')) return JSON.parse(t);
  if (t.startsWith('[')) return [...t.matchAll(/'''(.*?)'''|"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1] ?? JSON.parse(`"${x[2]}"`));
  if (/^\d+$/.test(t)) return Number(t);
  if (t === 'true' || t === 'false') return t === 'true';
  throw new Error(`gitleaks-mainframe.toml: value not read: ${t}`);
};

// The [[rules]] tables of the file, each with its allowlist folded in.
export function readToml(text) {
  const rules = [];
  let into = null;
  for (const line of text.split('\n')) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    if (l === '[[rules]]') { rules.push((into = { allowlist: {} })); continue; }
    if (l === '[rules.allowlist]') { into = rules.at(-1).allowlist; continue; }
    if (l.startsWith('[')) { into = null; continue; }
    const kv = /^([A-Za-z]+)\s*=\s*(.+)$/.exec(l);
    if (kv && into) into[kv[1]] = value(kv[2]);
  }
  return rules;
}

// A gitleaks regex as a JavaScript one: a leading (?flags) group becomes the flags.
export function jsRegex(re, extra = '') {
  const lead = /^\(\?([ims]+)\)/.exec(re);
  const body = lead ? re.slice(lead[0].length) : re;
  if (/\(\?[a-zA-Z]|\(\?P<|\\[AzZpPQE]/.test(body)) throw new Error(`gitleaks-mainframe.toml: no JavaScript equivalent for ${re}`);
  return new RegExp(body, [...new Set([...(lead ? lead[1] : ''), ...extra])].join(''));
}

const secretOf = (m, group) => (group ? m[group] : m.slice(1).find((g) => g !== undefined)) ?? m[0];

export const SHAPE_RULES = readToml(readFileSync(new URL('../../rules/gitleaks-mainframe.toml', import.meta.url), 'utf8'))
  .filter((r) => r.id in SHAPES)
  .map((r) => ({
    id: r.id,
    pattern: jsRegex(r.regex, 'g'),
    secretGroup: r.secretGroup || 0,
    keywords: (r.keywords || []).map((k) => k.toLowerCase()),
    allow: (r.allowlist.regexes || []).map((x) => jsRegex(x)),
    allowTarget: r.allowlist.regexTarget || 'secret',
  }));

// Every shape in the text, at the line its first non-blank character is on.
export function credentialsIn(text) {
  const lower = text.toLowerCase();
  const out = [];
  for (const s of SHAPE_RULES) {
    if (s.keywords.length && !s.keywords.some((k) => lower.includes(k))) continue;
    for (const m of text.matchAll(s.pattern)) {
      const target = s.allowTarget === 'match' ? m[0] : secretOf(m, s.secretGroup);
      if (s.allow.some((a) => a.test(target))) continue;
      const start = m.index + (m[0].length - m[0].trimStart().length);
      out.push({ shape: s.id, line: text.slice(0, start).split('\n').length, detail: SHAPES[s.id](m[0]) });
    }
  }
  return out;
}

export function* scanSecretsSteps(root, opts = {}) {
  const tree = treeFor(root, opts);
  const files = tree.list().filter((f) => isProgram(f) || isCopybook(f)).filter(inScope(opts));
  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0 };

  const run = yield loopOver(files, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    stats.filesScanned++;
    const path = relPath(root, f);
    for (const c of credentialsIn(src)) findings.push({ rule: 'credential-in-source', path, line: c.line, detail: `${c.detail} (${c.shape})` });
    return src.length;
  }, { label: 'secrets', maxBytes: opts.maxSourceBytes ?? Infinity });

  return report('secrets', { rules: SECRETS_RULES, findings, stats, run });
}

export const scanSecrets = (root, opts = {}) => drive(scanSecretsSteps(root, opts));
