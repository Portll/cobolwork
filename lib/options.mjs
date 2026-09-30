// SPDX-License-Identifier: AGPL-3.0-or-later
// Whether the options a program is compiled with generate the run-time checks a policy requires:
// docs/spec/build-gate.md §7. Enterprise COBOL's options and what they mean are from IBM's
// documentation; the GnuCOBOL flags are recorded in provenance/compiler-options.json with how each
// was confirmed by compiling. Nothing here is taken from GnuCOBOL's source (spec §16).
import { basename, posix } from 'node:path';
import { PROGRAM_EXT } from './sources.mjs';
import { OPTION_SPELLINGS } from './enterprise-options.mjs';

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

// Each family's spellings, as IBM's option table gives them. A spelling the table does not hold is
// not accepted, so an option the gate cannot read counts as absent, which fails closed.
const spellingsOf = (option, off) => Object.keys(OPTION_SPELLINGS).filter((s) => OPTION_SPELLINGS[s][0] === option && OPTION_SPELLINGS[s][1] === off);
const FAMILIES = Object.fromEntries(['SSRANGE', 'NUMCHECK', 'PARMCHECK'].map((f) => [f, { on: spellingsOf(f, false), off: spellingsOf(f, true) }]));
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

// Shell text read at its top level: outside quotes, $( ), ${ } and backquotes, and past an escaped
// character. Returns the words, quotes removed and substitutions kept as written, and the separators
// between simple commands. A batch or PowerShell file takes the backslash as a path separator.
const ESCAPE = { sh: '\\', batch: '^', powershell: '`' };
export function shellTokens(text, dialect = 'sh') {
  const esc = ESCAPE[dialect] || ESCAPE.sh;
  const quotes = dialect === 'batch' ? '"' : '"\'';
  const s = String(text);
  const out = [];
  const stack = [];
  let word = null;
  const add = (c) => { word = (word ?? '') + c; };
  const flush = () => { if (word !== null) out.push({ word }); word = null; };
  const inSubstitution = () => stack.some((c) => c === ')' || c === '}');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const open = stack[stack.length - 1];
    if (open === "'" || open === '`') {
      if (ch === open) { stack.pop(); add(stack.length ? ch : ''); } else add(ch);
      continue;
    }
    if (ch === esc && i + 1 < s.length) { add(inSubstitution() ? ch + s[i + 1] : s[i + 1]); i++; continue; }
    if (ch === '$' && (s[i + 1] === '(' || s[i + 1] === '{')) { stack.push(s[i + 1] === '(' ? ')' : '}'); add(ch + s[i + 1]); i++; continue; }
    if (open === '"') {
      if (ch === '"') { stack.pop(); add(stack.length ? ch : ''); } else add(ch);
      continue;
    }
    if (quotes.includes(ch) || (ch === '`' && dialect === 'sh')) { add(stack.length ? ch : ''); stack.push(ch); continue; }
    if (open) {
      if (open === ')' && ch === '(') stack.push(')');
      else if (ch === open) stack.pop();
      add(ch);
      continue;
    }
    if (/\s/.test(ch)) { flush(); continue; }
    if (ch === '#' && word === null && dialect !== 'batch') break;
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||') { flush(); out.push({ sep: two }); i++; continue; }
    if (ch === ';' || ch === '|' || (ch === '&' && !/[<>]/.test(s[i - 1] || '') && s[i + 1] !== '>')) { flush(); out.push({ sep: ch }); continue; }
    add(ch);
  }
  flush();
  return out;
}

const commandsOf = (tokens) => {
  const out = [[]];
  for (const t of tokens) { if (t.sep) out.push([]); else out[out.length - 1].push(t.word); }
  return out.filter((words) => words.length);
};

// Words that come before the command they run: a CI step's key, a list marker, a Dockerfile
// instruction, a wrapper, a shell keyword. A Makefile recipe line may open with @, - or +.
const LEAD = /^(?:-|[A-Za-z_][\w-]*:|run|cmd|entrypoint|sudo|exec|time|nohup|nice|env|then|do|else|if|elif|while|until|!|\{|\(|call|&|@)$/i;
const PREFIX = /^[@+\-(]+/;
// A command that prints its arguments: a message naming cobc runs nothing.
const MESSAGE = /^(?:echo|printf|print|say|write-(?:host|output|error|warning|verbose|information)|info|warn|warning|error|die|fail|log|rem|:)$/i;
const leadOf = (words) => words.findIndex((w) => !LEAD.test(w) && !/^[A-Za-z_]\w*=/.test(w));
const argsOf = (words) => {
  const out = [];
  for (const w of words) {
    if (/^(?:\d*[<>]|&>)/.test(w) || /^(?:[;)}\]]|\]\]|fi|done|then)$/.test(w)) break;
    out.push(w);
  }
  return out;
};

// The argument vector of each cobc command in one simple command. A command held in one word -
// sh -c "…", an alias, a CMD's string - is read as a command line of its own.
function cobcCommands(words, dialect, depth = 0) {
  const at = leadOf(words);
  if (at < 0 || MESSAGE.test(words[at].replace(PREFIX, ''))) return [];
  for (let i = at; i < words.length; i++) {
    const w = words[i];
    if (isCobc(w.replace(PREFIX, ''))) return [argsOf(words.slice(i + 1))];
    const inner = w.replace(/^[A-Za-z_]\w*=/, '');
    if (depth < 2 && /\s/.test(inner) && /cobc/i.test(inner)) {
      const found = commandsOf(shellTokens(inner, dialect)).flatMap((ws) => cobcCommands(ws, dialect, depth + 1));
      if (found.length) return found;
    }
  }
  return [];
}

// A directory a cd names, relative to where the script runs; null where it is not a plain path.
const changeDir = (dir, to) => (!to || /[$%~`]/.test(to) || /^(?:\/|[A-Za-z]:[\\/]|-$)/.test(to) ? null
  : posix.normalize(posix.join(dir || '.', to.replace(/\\/g, '/'))));

// The cobc commands in a command line, each with the directory a cd before it on the line moved to.
// `state.dir` carries a cd forward to later lines, for a script whose lines one shell runs.
function commandLine(text, dialect, state, line, out) {
  for (const words of commandsOf(Array.isArray(text) ? text.map((word) => ({ word })) : shellTokens(text, dialect))) {
    const at = leadOf(words);
    const lead = at >= 0 ? words[at].replace(PREFIX, '').toLowerCase() : '';
    if (lead === 'cd' || lead === 'pushd' || lead === 'set-location') { state.dir = changeDir(state.dir, words.slice(at + 1).find((w) => !/^-./.test(w))); continue; }
    for (const args of cobcCommands(words, dialect)) {
      if (cobcOperands(args).length) out.push({ line, args, ...(state.dir && state.dir !== '.' ? { dir: state.dir } : {}) });
    }
  }
}

const unquote = (v) => String(v).trim().replace(/^(["'])(.*)\1$/s, '$2');

// A variable a build script assigns, as [name, operator, value]; null for a line that runs something.
function assignmentOf(line, kind) {
  if (kind === 'make') {
    const m = /^\s*(?:(?:export|override)\s+)*([A-Za-z_]\w*)\s*(:{1,3}=|[?+!]?=)(?!=)\s*(.*)$/.exec(line);
    return m ? [m[1], m[2], m[3].trim()] : null;
  }
  if (kind === 'batch') {
    const m = /^\s*@?set\s+(?:\/a\s+)?"?([A-Za-z_][\w.-]*)=(.*?)"?\s*$/i.exec(line);
    return m && !/^\s*@?set\s+\/p/i.test(line) ? [m[1].toUpperCase(), '=', m[2]] : null;
  }
  if (kind === 'powershell') {
    const m = /^\s*\$([A-Za-z_]\w*)\s*=(?!=)\s*(.*)$/.exec(line);
    return m ? [m[1].toUpperCase(), '=', m[2].replace(/^@\(|\)$/g, '').split(/\s*,\s*/).map(unquote).join(' ')] : null;
  }
  if (kind === 'docker') {
    const m = /^\s*(?:ENV|ARG)\s+([A-Za-z_]\w*)(?:\s*=\s*|\s+)(.*)$/i.exec(line);
    if (m) return [m[1], '=', unquote(m[2])];
  }
  const m = /^\s*(?:(?:export|local|readonly|declare|typeset)(?:\s+-\w+)*\s+)?([A-Za-z_]\w*)(\+?=)(.*)$/.exec(line);
  if (!m) return null;
  const rest = shellTokens(m[3], 'sh');
  // NAME=value cmd … runs cmd with NAME in its environment: the line is a command.
  if (rest.length > 1 && !rest[1].sep) return null;
  return [m[1], m[2], rest.length && !rest[0].sep ? rest[0].word : ''];
}

// The variables a line refers to, replaced by the values the file assigned them, until none is left
// that the file assigns. Make's $(wildcard …) becomes its pattern.
function expanded(text, vars, kind) {
  const get = (n) => vars.get(kind === 'batch' || kind === 'powershell' ? n.toUpperCase() : n);
  const once = (t) => {
    if (kind === 'make') return t.replace(/\$\(wildcard\s+([^()]*)\)|\$\(([A-Za-z_]\w*)\)|\$\{([A-Za-z_]\w*)\}/g, (m, glob, a, b) => (glob !== undefined ? glob.trim() : get(a || b) ?? m));
    if (kind === 'batch') return t.replace(/%([A-Za-z_][\w.-]*)%|!([A-Za-z_][\w.-]*)!/g, (m, a, b) => get(a || b) ?? m);
    if (kind === 'powershell') return t.replace(/\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)(?!:)/g, (m, a, b) => get(a || b) ?? m);
    return t.replace(/\$\{([A-Za-z_]\w*)(?:(:?[-=])([^}]*))?\}|\$\(([A-Za-z_]\w*)\)|\$([A-Za-z_]\w*)/g, (m, a, op, fallback, b, c) => get(a || b || c) ?? (op ? fallback : m));
  };
  let t = text;
  for (let k = 0; k < 8; k++) { const next = once(t); if (next === t) break; t = next; }
  return t;
}

// Every cobc command a build script runs that names a source file, with the variables the same file
// assigns substituted: [{ line, args, dir? }]. `kind` is make, sh, yaml, docker, batch or powershell.
// A command whose options come from a variable set elsewhere keeps the reference, which reads as no
// option; one that names no source - cobc --version, which cobc - compiles nothing and is left out.
export function cobcInvocations(text, { kind = 'sh' } = {}) {
  const dialect = kind === 'batch' || kind === 'powershell' ? kind : 'sh';
  const vars = new Map();
  const continuation = { batch: /\^$/, powershell: /`$/ }[kind] || /\\$/;
  // A continued line is one command, and keeps the line it starts on.
  const lines = [];
  let held = null;
  String(text).split(/\r?\n/).forEach((raw, i) => {
    const continues = continuation.test(raw);
    const part = continues ? raw.slice(0, -1) : raw;
    held = held ? { line: held.line, text: `${held.text} ${part}` } : { line: i + 1, text: part };
    if (!continues) { lines.push(held); held = null; }
  });
  if (held) lines.push(held);
  const out = [];
  // One shell runs a script's lines in turn, so a cd holds; each line of a recipe or a CI step's
  // run list, and each Dockerfile instruction, starts where the file is.
  const state = { dir: null };
  const carries = kind === 'sh' || kind === 'batch' || kind === 'powershell';
  let recipe = false;
  for (const { line, text: raw } of lines) {
    if (!carries) state.dir = null;
    if (!raw.trim() || (kind === 'batch' && /^\s*@?(?:rem\b|::)/i.test(raw)) || (kind !== 'batch' && /^\s*#/.test(raw))) continue;
    // In a Makefile a tab opens a recipe line when a rule is open; the rule stays open until a line
    // that is neither a recipe line nor a conditional.
    const recipeLine = kind === 'make' && recipe && /^\t/.test(raw);
    const assigned = recipeLine ? null : assignmentOf(raw, kind);
    if (assigned) {
      const [name, op, value] = assigned;
      if (op === '?=' && vars.has(name)) continue;
      if (op === '!=') continue;
      // A shell assigns the value as it stands; make's = and ?= defer it to where it is used.
      const v = kind !== 'make' || /^:+=$/.test(op) ? expanded(value, vars, kind) : value;
      vars.set(name, op.startsWith('+') && vars.has(name) ? `${vars.get(name)} ${v}` : v);
      if (kind === 'make' && !/^\t/.test(raw)) recipe = false;
      continue;
    }
    if (kind === 'make' && !/^\t/.test(raw) && !/^\s*(?:ifn?eq|ifn?def|else|endif)\b/.test(raw)) recipe = /^[^\s#:=][^:=]*::?(?!=)/.test(raw);
    // A recipe line's @, - and + are make's; the shell reads what follows them.
    let l = expanded(kind === 'make' ? raw.replace(/^\t[@+-]+/, '\t') : raw, vars, kind);
    if (kind === 'make') l = l.replace(/\$\$/g, '$');
    const exec = kind === 'docker' && /^\s*(?:RUN|CMD|ENTRYPOINT)\s+(\[.*\])\s*$/i.exec(l);
    let words = null;
    if (exec) { try { const list = JSON.parse(exec[1]); if (Array.isArray(list)) words = list.map(String); } catch { /* the shell form after all */ } }
    commandLine(words || l, dialect, state, line, out);
  }
  return out;
}

// JSON with the comments and trailing commas VS Code accepts in its settings files.
function looseJson(text) {
  const s = String(text);
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
      out += s.slice(i, j + 1);
      i = j;
    } else if (ch === '/' && s[i + 1] === '/') {
      while (i < s.length && s[i] !== '\n') i++;
      out += '\n';
    } else if (ch === '/' && s[i + 1] === '*') {
      const end = s.indexOf('*/', i + 2);
      i = end < 0 ? s.length : end + 1;
    } else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

// The cobc commands an editor's task file runs: VS Code's tasks.json. A task's command line is its
// command and its arguments, read as its shell reads them, with the variants it gives for Windows,
// Linux and macOS; it runs in the workspace folder, or in its options.cwd. ${workspaceFolder} is that
// folder, and a variable that names the open file stands for any file.
export function cobcTasks(text) {
  let doc;
  try { doc = looseJson(text); } catch { return []; }
  const lines = String(text).split(/\r?\n/);
  const lineOf = (...needles) => {
    for (const n of needles) {
      const at = n ? lines.findIndex((l) => l.includes(n)) : -1;
      if (at >= 0) return at + 1;
    }
    return 1;
  };
  const valueOf = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v.value : v);
  const folder = (v) => String(v).replace(/\$\{(?:workspaceFolder|workspaceRoot)(?::[^}]*)?\}/g, '.').replace(/\$\{(?:\/|pathSeparator)\}/g, '/');
  const quoted = (a) => { const s = String(valueOf(a) ?? ''); return /[\s"]/.test(s) || s === '' ? `"${s.replace(/"/g, '\\"')}"` : s; };
  const out = [];
  const tasks = [doc, ...(Array.isArray(doc && doc.tasks) ? doc.tasks : [])];
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    for (const [variant, dialect] of [[task, 'sh'], [task.linux, 'sh'], [task.osx, 'sh'], [task.windows, 'powershell']]) {
      if (!variant || typeof variant !== 'object') continue;
      const command = valueOf(variant.command);
      if (typeof command !== 'string' || !/cobc/i.test(`${command} ${JSON.stringify(variant.args || task.args || [])}`)) continue;
      const args = Array.isArray(variant.args) ? variant.args : Array.isArray(task.args) ? task.args : [];
      const cwd = (variant.options && variant.options.cwd) || (task.options && task.options.cwd);
      const dir = typeof cwd === 'string' ? changeDir(null, folder(cwd)) : null;
      const line = lineOf(JSON.stringify(command).slice(1, 41), task.label && JSON.stringify(task.label));
      const state = { dir };
      const found = [];
      commandLine(folder([command, ...args.map(quoted)].join(' ')), dialect, state, line, found);
      out.push(...found);
    }
  }
  return out;
}

// Options whose value is the next argument, which is not a source file: the output file, include and
// library directories, a library, and options for the C compiler and the linker. Each was observed to
// take the next argument (provenance/compiler-options.json).
const TAKES_VALUE = new Set(['-o', '-I', '-L', '-l', '-A', '-Q', '-fec', '-fno-ec']);
const SOURCE_FILE = new RegExp(`(?:${PROGRAM_EXT.map((e) => e.replace('.', '\\.')).join('|')})$`, 'i');
// A variable, a batch argument, a glob or find's {}: a file the command names only when it runs.
const UNNAMED = /[$%*?!]|\{\}/;

// The operands of a cobc command that name source files, as written.
export function cobcOperands(args) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    const a = String(args[i]);
    if (TAKES_VALUE.has(a)) { i++; continue; }
    if (a.startsWith('-')) continue;
    if (SOURCE_FILE.test(a) || UNNAMED.test(a)) out.push(a);
  }
  return out;
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
