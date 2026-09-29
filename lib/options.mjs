// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether the options a program is compiled with generate the run-time checks a policy requires:
// docs/spec/build-gate.md §7. Enterprise COBOL's options and what they mean are from IBM's
// documentation; the GnuCOBOL flags are recorded in provenance/compiler-options.json with how each
// was confirmed by compiling. Nothing here is taken from GnuCOBOL's source (spec §16).
import { basename } from 'node:path';

// Split on blanks and commas outside parentheses: SSRANGE(NOZLEN,ABD) is one option.
export function optionTokens(text) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of String(text)) {
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (depth === 0 && /[\s,]/.test(ch)) { if (cur) out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((t) => t.toUpperCase());
}

// The option cards before a program's first line of code, each with the line it is on.
export function optionCards(text) {
  const cards = [];
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const trimmed = l.trim();
    if (!trimmed) continue;
    const body = /^(CBL|PROCESS)\b/i.test(trimmed) ? trimmed : l.slice(7).trim();
    const m = /^(CBL|PROCESS)\b(.*)$/i.exec(body);
    if (m) { cards.push({ level: m[1].toUpperCase(), line: i + 1, options: optionTokens(m[2]) }); continue; }
    if (trimmed.startsWith('*') || l[6] === '*' || l[6] === '/') continue;
    break;
  }
  return cards;
}

const parse = (token) => {
  const m = /^([A-Z0-9-]+)(?:\((.*)\))?$/.exec(token);
  return m ? { name: m[1], subs: m[2] === undefined ? [] : optionTokens(m[2]) } : { name: token, subs: [] };
};

// Each family's spellings. An abbreviation IBM does not document is not accepted, so an option the
// gate cannot read counts as absent, which fails closed.
const FAMILIES = {
  SSRANGE: { on: ['SSRANGE', 'SSR'], off: ['NOSSRANGE', 'NOSSR'] },
  NUMCHECK: { on: ['NUMCHECK'], off: ['NONUMCHECK'] },
  PARMCHECK: { on: ['PARMCHECK', 'PC'], off: ['NOPARMCHECK', 'NOPC'] },
};
const FAMILY_OF_CHECK = { subscript: 'SSRANGE', 'reference-modification': 'SSRANGE', 'numeric-data': 'NUMCHECK', 'argument-length': 'PARMCHECK' };

// Whether one family's setting abends on a failed check. A bare SSRANGE is SSRANGE(NOZLEN,ABD); a
// bare NUMCHECK or PARMCHECK is MSG, which reports and carries on.
function abends(family, subs) {
  if (subs.includes('MSG')) return false;
  if (family === 'SSRANGE') return true;
  if (!subs.includes('ABD')) return false;
  if (family === 'NUMCHECK') return !subs.some((s) => s === 'NOZON' || s === 'NOPAC');
  return true;
}

// Whether the last SSRANGE setting in `tokens` abends on a bad index: true, false, or null where
// none is set. Tokens split at the parenthesis's commas, as the parser's option list is, are rejoined.
export function ssrangeAbends(tokens) {
  const whole = optionTokens(tokens.join(','));
  const f = FAMILIES.SSRANGE;
  for (let k = whole.length - 1; k >= 0; k--) {
    const { name, subs } = parse(whole[k]);
    if (f.off.includes(name)) return false;
    if (f.on.includes(name)) return abends('SSRANGE', subs);
  }
  return null;
}

const levelText = (o) => (o.level === 'site' ? 'compilerOptions in cobolwork.site.json'
  : o.level === 'JCL' ? `the compile step at ${o.file}:${o.line}` : `the ${o.level} statement at line ${o.line}`);

// One Enterprise COBOL program: `site` is the estate's declared defaults, `cards` its own CBL and
// PROCESS statements. Returns { checks: [{ check, ok, why }], forbidden: [why] }; ok is null where
// no level names the option and the estate has not declared its defaults.
export function enterpriseChecks({ required, site = [], steps = [], cards = [], forbid = [] }) {
  const settings = [
    ...site.flatMap((s) => optionTokens(s).map((token) => ({ token, level: 'site' }))),
    ...steps.flatMap((s) => s.options.map((token) => ({ token, level: 'JCL', file: s.file, line: s.line }))),
    ...cards.flatMap((c) => c.options.map((token) => ({ token, level: c.level, line: c.line }))),
  ];
  // What no level sets is the installation default, which an installation can change from IBM's.
  // Only the estate's declared defaults say what it is; a compile step that is silent does not.
  const declared = site.length > 0;
  const lastOf = (names) => settings.filter((s) => names.includes(parse(s.token).name)).pop() || null;
  const checks = required.map((check) => {
    const family = FAMILY_OF_CHECK[check];
    const f = FAMILIES[family];
    const last = lastOf([...f.on, ...f.off]);
    if (!last) {
      return declared
        ? { check, ok: false, why: `${check} needs ${family}, which no level sets, and Enterprise COBOL's default is NO${family}` }
        : { check, ok: null, why: `${check} needs ${family}, and no level this gate can read sets it: declare the estate's defaults as compilerOptions in cobolwork.site.json` };
    }
    const { name, subs } = parse(last.token);
    if (f.off.includes(name)) return { check, ok: false, why: `${check} needs ${family}, and ${last.token} is set by ${levelText(last)}` };
    if (!abends(family, subs)) return { check, ok: false, why: `${check} needs ${family} to abend, and ${last.token} set by ${levelText(last)} reports and carries on (MSG)` };
    return { check, ok: true, why: `${last.token} by ${levelText(last)}` };
  });
  const forbidden = [];
  for (const entry of forbid.map((x) => x.toUpperCase())) {
    const want = parse(entry);
    const last = settings.filter((s) => parse(s.token).name === want.name).pop();
    if (last && last.token === entry) forbidden.push(`${entry} is set by ${levelText(last)}, and the policy forbids it`);
  }
  return { checks, forbidden };
}

const EXCEPTION_OF_CHECK = {
  subscript: 'EC-BOUND-SUBSCRIPT',
  'reference-modification': 'EC-BOUND-REF-MOD',
  'numeric-data': 'EC-DATA-INCOMPATIBLE',
  'argument-length': 'EC-PROGRAM-ARG-MISMATCH',
};

export const isCobc = (command) => /^cobc(\.exe)?$/i.test(basename(String(command || '')));

const exceptionName = (v) => {
  const u = String(v).toUpperCase();
  return u.startsWith('EC-') ? u : `EC-${u}`;
};
// A condition name covers itself and every name below it: EC-BOUND covers EC-BOUND-SUBSCRIPT.
const covers = (name, target) => name === 'EC-ALL' || target === name || target.startsWith(`${name}-`);

// IBM's compile procedures name their compile step COBOL; a site's own procedure is found by the
// step in it that runs IGYCRCTL.
const IBM_COMPILE_PROC = /^IGYW[CP]/;
const memberOf = (dsn) => { const m = /\(([A-Z0-9@#$]{1,8})\)\s*$/i.exec(String(dsn || '')); return m ? m[1].toUpperCase() : null; };

// A PARM as JCL writes it: quoted, or a parenthesised list, or both.
const parmText = (v) => String(v || '').trim().replace(/^\((.*)\)$/s, '$1').replace(/^'(.*)'$/s, '$1');
// A procedure's symbols filled from its caller's keywords, as JCL substitutes them.
const withSymbols = (text, keywords) => String(text || '').replace(/&([A-Z@#$][A-Z0-9@#$]{0,7})\.?/gi, (m, name) => {
  const v = keywords && keywords.get(name.toUpperCase());
  return v === undefined || v === null ? m : String(v).replace(/^'(.*)'$/, '$1');
});

// The options each JCL compile step gives the member it compiles: PARM on EXEC PGM=IGYCRCTL, or on
// the EXEC of a compile procedure, PARM.<step> or an unqualified PARM, which JCL gives the first
// step. The procedure's own PARM applies where the caller gives none. The member is named on the
// compile step's SYSIN: <step>.SYSIN, or an unqualified SYSIN, which JCL adds to the first step, or
// the SYSIN a procedure in the tree declares, with the caller's symbols filled in. `parsed` is
// parseJcl's output for every file; a member whose name is still symbolic is not attributed.
export function compileStepOptions(parsed) {
  const procs = new Map();
  for (const p of parsed) for (const proc of p.procs || []) {
    const at = proc.steps.findIndex((s) => String(s.pgm || '').toUpperCase() === 'IGYCRCTL');
    if (at < 0) continue;
    const compile = proc.steps[at];
    const sysin = compile.dds.find((d) => String(d.name || '').toUpperCase() === 'SYSIN');
    procs.set(String(proc.name).toUpperCase(), { step: compile.name, first: at === 0, parm: compile.parm, sysin: sysin ? sysin.rawDsn || sysin.dsn : null });
  }
  const out = [];
  for (const p of parsed) for (const step of p.steps || []) {
    const pgm = String(step.pgm || '').toUpperCase();
    const proc = String(step.proc || '').toUpperCase();
    if (pgm === 'IGYCRCTL' && !step.inProc) {
      const sysin = step.dds.find((d) => String(d.name || '').toUpperCase() === 'SYSIN');
      const member = sysin && memberOf(sysin.dsn);
      if (member) out.push({ member, options: optionTokens(parmText(step.parm)), file: p.file, line: step.line });
      continue;
    }
    const own = procs.get(proc);
    if (!own && !IBM_COMPILE_PROC.test(proc)) continue;
    const compileStep = own ? String(own.step).toUpperCase() : 'COBOL';
    const firstIsCompile = own ? own.first : true;
    const dd = (name) => step.dds.find((d) => String(d.name || '').toUpperCase() === name);
    const sysin = dd(`${compileStep}.SYSIN`) || (firstIsCompile ? dd('SYSIN') : null);
    const kw = step.keywords || new Map();
    const member = sysin ? memberOf(sysin.dsn) : own && own.sysin ? memberOf(withSymbols(own.sysin, kw)) : null;
    if (!member) continue;
    const given = kw.get(`PARM.${compileStep}`) ?? (firstIsCompile ? kw.get('PARM') : undefined) ?? null;
    const parm = given !== null ? parmText(given) : parmText(own && own.parm);
    out.push({ member, options: optionTokens(parm), file: p.file, line: step.line });
  }
  return out;
}

// Every cobc command a build script runs, with Makefile and shell variables it assigns in the same
// file substituted: [{ line, args }]. A command whose options come from a variable set elsewhere keeps
// the reference, which reads as no option.
export function cobcInvocations(text) {
  const vars = new Map();
  // A line ending in a backslash continues on the next; the command keeps the line it starts on.
  const lines = [];
  let held = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const continues = /\\$/.test(raw);
    const part = continues ? raw.slice(0, -1) : raw;
    held = held ? { line: held.line, text: `${held.text} ${part}` } : { line: i + 1, text: part };
    if (!continues) { lines.push(held); held = null; }
  });
  if (held) lines.push(held);
  const out = [];
  lines.forEach(({ line, text: raw }) => {
    const l = raw.replace(/^\s*#.*$/, '');
    const assign = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*(?:[:?+]?=)\s*(.*)$/.exec(l);
    if (assign && !/^\s*\S+\s*==/.test(l)) {
      const [, name, value] = assign;
      const clean = value.replace(/^["']|["']$/g, '');
      vars.set(name, /\+=/.test(l) && vars.has(name) ? `${vars.get(name)} ${clean}` : clean);
      return;
    }
    const expanded = l.replace(/\$\(([A-Za-z_][A-Za-z0-9_]*)\)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (m, a, b, c) => (vars.has(a || b || c) ? vars.get(a || b || c) : m));
    for (const command of expanded.split(/&&|\|\||;|\|/)) {
      const words = command.trim().split(/\s+/).filter(Boolean);
      // The command may open a quoted string an alias or a RUN line assigns: compile="cobc -x …".
      const at = words.findIndex((w) => isCobc(w.replace(/^.*[="']/, '').replace(/^[@-]+/, '')));
      if (at < 0) continue;
      const args = [];
      for (const w of words.slice(at + 1)) { if (/^[<>]/.test(w) || /^\d?>/.test(w)) break; args.push(w.replace(/^["']+|["']+$/g, '')); }
      out.push({ line, args });
    }
  });
  return out;
}

// The cobc tasks an editor's task file runs: VS Code's tasks.json, a command and its argument list.
export function cobcTasks(text) {
  let doc;
  try { doc = JSON.parse(String(text).replace(/^\s*\/\/.*$/gm, '')); } catch { return []; }
  const lines = String(text).split(/\r?\n/);
  const lineOf = (label) => Math.max(1, lines.findIndex((l) => label && l.includes(JSON.stringify(label))) + 1);
  return (Array.isArray(doc && doc.tasks) ? doc.tasks : [])
    .filter((t) => t && typeof t.command === 'string' && isCobc(t.command.trim().split(/\s+/)[0]))
    .map((t) => ({ line: lineOf(t.label), args: [...t.command.trim().split(/\s+/).slice(1), ...(Array.isArray(t.args) ? t.args.map(String) : [])] }));
}

// A cobc argument vector. Returns { checks, forbidden, add }: `add` holds the -fec options that
// supply a required check nothing turned on, and `forbidden` the options the policy's forbid list
// names. A check turned off is a failed check, not overridden: appending past it would hide a build
// configured against the policy.
export function cobcChecks(args, { required, forbid = [] }) {
  const state = new Map();
  const turnedOff = new Map();
  const set = (name, on, arg) => {
    for (const check of required) {
      if (!covers(name, EXCEPTION_OF_CHECK[check])) continue;
      state.set(check, on);
      if (on) turnedOff.delete(check); else turnedOff.set(check, arg);
    }
  };
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (a === '-debug' || a === '-d') { set('EC-ALL', true, a); continue; }
    const m = /^-f(no-)?ec(?:=(.*))?$/.exec(a);
    if (!m) continue;
    const value = m[2] !== undefined ? m[2] : args[++i];
    const shown = m[2] !== undefined ? a : `${a} ${value ?? ''}`.trim();
    if (value === undefined) continue;
    set(exceptionName(value), !m[1], shown);
  }
  const forbidden = [];
  for (const entry of forbid) {
    const hit = args.find((a) => a === entry || String(a).startsWith(`${entry}=`));
    if (hit) forbidden.push(`${hit} is on the command line, and the policy forbids it`);
  }
  const add = [];
  const checks = required.map((check) => {
    if (state.get(check) === true) return { check, ok: true, why: 'turned on by the command line' };
    if (turnedOff.has(check)) return { check, ok: false, why: `${turnedOff.get(check)} turns off the ${check} check` };
    const flag = `-fec=${EXCEPTION_OF_CHECK[check]}`;
    if (!add.includes(flag)) add.push(flag);
    return { check, ok: true, added: true, why: `added as ${flag}` };
  });
  return { checks, forbidden, add };
}

// The same, for a command the gate reads rather than runs: a check nothing turned on is missing.
export function scriptedCobcChecks(args, opts) {
  const r = cobcChecks(args, opts);
  return {
    checks: r.checks.map((c) => (c.added ? { check: c.check, ok: false, why: `${c.check} needs -fec=${EXCEPTION_OF_CHECK[c.check]} or -debug, and the command gives neither` } : c)),
    forbidden: r.forbidden,
  };
}
