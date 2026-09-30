// SPDX-License-Identifier: AGPL-3.0-or-later
import { resolve, relative, sep, dirname } from 'node:path';
import { realpathSync } from 'node:fs';
import { readSource, isProgram, isCopybook, isJcl } from './sources.mjs';
import { parseFile, buildFileIndex, detectFormat } from './parser.mjs';
import { EVIDENCE } from './kernel/findings.mjs';
import { REGISTRY } from './kernel/registry.mjs';
import { WHO_ACTS } from './tui/model.mjs';
import { verificationPlan } from './verify.mjs';
import { cobolCard, statementCard } from './cards.mjs';

const HIDDEN_RULES = new Set(Object.keys(REGISTRY.find((s) => s.name === 'hidden').rules));

// The columns quoted: COBOL's indicator and program text, JCL's statement field, or the whole line.
function codeArea(line, kind, format) {
  if (kind === 'jcl') { const c = statementCard(line); return { text: c.text, seq: '', rest: c.sequence }; }
  if (kind !== 'cobol') return { text: line, seq: '', rest: '' };
  const c = cobolCard(line, format);
  return { text: c.indicator + c.text, seq: c.sequence, rest: c.ignored };
}

const NOTE = 'This packet contains source text from the files it names. A cobolwork report never does: '
  + 'treat the packet as you would the source, and do not store or send it where the source may not go. '
  + 'Its verification plan is for a test region the estate owns and authorises the test in.';

function contained(root, rel) {
  const base = resolve(root);
  const abs = resolve(base, rel);
  if (abs !== base && !abs.startsWith(base + sep)) return { why: 'the path resolves outside the root' };
  let real;
  try { real = realpathSync(abs); } catch { return { why: 'the file is not there' }; }
  const realBase = realpathSync(base);
  if (real !== realBase && !real.startsWith(realBase + sep)) return { why: 'the path is a link that leads outside the root' };
  return { abs };
}

// A hop's location: from `via` ("MOVE at pos/P1.cbl:9"), else the related entry for its file.
function hopAt(hop, finding) {
  const m = /\bat (.+):(\d+)$/.exec(hop.via || '');
  if (m) return { path: m[1], line: Number(m[2]) };
  const rel = (finding.related || []).find((r) => r.path === hop.file);
  return rel ? { path: rel.path, line: rel.line } : { path: hop.file, line: null };
}

export function explainFinding(report, fingerprint, { root }) {
  const active = report.findings.filter((f) => f.fingerprint === fingerprint);
  // A baseline moves a judged finding out of `findings` into `suppressed`. Explain still reaches it,
  // and the packet carries the judgement rather than showing it as live.
  const matches = active.length ? active : (report.suppressed || []).filter((f) => f.fingerprint === fingerprint);
  if (!matches.length) return null;
  const f = matches[0];
  const files = new Map();
  const unread = [];
  const kindOf = (abs) => (isJcl(abs) ? 'jcl' : isProgram(abs) || isCopybook(abs) ? 'cobol' : null);
  const fileOf = (path) => {
    if (!path) return null;
    if (files.has(path)) return files.get(path);
    const c = contained(root, path);
    let file = null;
    if (!c.abs) unread.push({ path, why: c.why });
    else if (!kindOf(c.abs)) unread.push({ path, why: 'not a source file cobolwork reads' });
    else {
      try {
        const text = readSource(c.abs).text;
        file = { kind: kindOf(c.abs), format: detectFormat(text), lines: text.split(/\r?\n/) };
      } catch (e) { unread.push({ path, why: `it could not be read: ${e.message}` }); }
    }
    files.set(path, file);
    return file;
  };
  const flagged = new Map();
  for (const x of [...report.findings, ...(report.suppressed || [])]) {
    if (HIDDEN_RULES.has(x.rule) && x.path && x.line) flagged.set(`${x.path}:${x.line}`, x.rule);
  }
  const quote = (path, line) => {
    const withheld = flagged.get(`${path}:${line}`);
    if (withheld) return { code: null, withheld };
    const file = fileOf(path);
    if (!file || !(line > 0 && line <= file.lines.length)) return { code: null };
    const area = codeArea(file.lines[line - 1], file.kind, file.format);
    const dropped = area.rest.trim() !== '' || /[^\d\s]/.test(area.seq);
    return { code: area.text.trimEnd(), ...(dropped ? { dropped } : {}) };
  };

  const hops = (f.trace || []).map((h, i) => {
    if (h.elided) return { n: i + 1, elided: h.elided, via: h.via };
    const at = hopAt(h, f);
    return { n: i + 1, program: h.program, item: h.item, file: h.file, via: h.via, path: at.path, line: at.line, ...quote(at.path, at.line) };
  });

  const parsed = new Map();
  let index = null;
  const programIn = (file, id) => {
    if (!parsed.has(file)) {
      const c = contained(root, file);
      let r = null;
      if (c.abs && kindOf(c.abs) === 'cobol') {
        index ??= buildFileIndex(resolve(root));
        try {
          r = parseFile(c.abs, { format: 'auto', copyFormat: 'auto', fileIndex: index.index, includeDirs: index.copyDirs, mainDir: dirname(c.abs) });
        } catch { r = null; }
      }
      parsed.set(file, r);
    }
    const r = parsed.get(file);
    return r && r.programs.find((p) => String(p.id).toUpperCase() === String(id).toUpperCase());
  };
  const declarations = [];
  const seen = new Set();
  const subjects = [...hops.filter((h) => h.item), ...(f.guard ? [{ program: f.guard.program, item: f.guard.item, file: f.guard.file }] : [])];
  for (const h of subjects) {
    const key = `${h.program}.${h.item}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const p = programIn(h.file, h.program);
    const it = p && p.items.find((x) => String(x.name).toUpperCase() === String(h.item).toUpperCase());
    if (!it) continue;
    declarations.push({
      program: h.program, item: h.item, level: it.level, picture: it.picture, usage: it.usage, size: it.size,
      offset: it.offset, section: it.section, occurs: it.occurs, redefines: it.redefines,
      path: it.file ? relative(resolve(root), resolve(it.file)).split(sep).join('/') : h.file,
      line: it.line,
    });
  }

  return {
    tool: 'cobolwork-explain',
    carriesSource: true,
    note: NOTE,
    fingerprint,
    shared: matches.length,
    ...(f.suppressed ? { suppressed: f.suppressed } : {}),
    finding: {
      rule: f.rule, sev: f.sev, ...(f.guardedFrom ? { guardedFrom: f.guardedFrom } : {}), cwe: f.cwe,
      evidence: f.evidence, claim: EVIDENCE[f.evidence] || null, whoActs: WHO_ACTS[f.evidence] || null,
      // What the finding lets someone do and the standard fix, from the finding if it carries its
      // own (a site-gated rule that became a defect), else the rule's, else null for an info kind.
      impact: f.impact ?? report.ruleImpact?.[f.rule] ?? null, remedy: f.remedy ?? report.ruleRemedy?.[f.rule] ?? null,
      program: f.program, path: f.path, line: f.line, crossProgram: !!f.crossProgram, detail: f.detail,
    },
    hops,
    sink: { path: f.path, line: f.line, ...quote(f.path, f.line) },
    guard: f.guard ? { ...f.guard, ...quote(f.guard.file, f.guard.line) } : null,
    related: (f.related || []).map((r) => ({ ...r, ...quote(r.path, r.line) })),
    declarations,
    verify: verificationPlan(f),
    unread,
  };
}
