// SPDX-License-Identifier: AGPL-3.0-or-later
import { createScreen, put, styleRow } from './screen.mjs';
import { ACTIONS, KEYMAPS, LEGEND, actionFor } from './keys.mjs';
import { EVIDENCE, EXPLOITABILITY } from '../kernel/findings.mjs';
import {
  banner, countsLine, exploitLine, rows as findingRows, viewLabel, DEFAULT_VIEW, SORT_NAMES, EVIDENCE_KINDS, VERDICTS, WHO_ACTS, SEV_LETTER,
} from './model.mjs';

export const PANELS = Object.freeze(['home', 'findings', 'finding', 'help']);
export const MIN_COLS = 80;
export const MIN_ROWS = 24;

export function initialState({ report, keymap = 'ispf', cols = MIN_COLS, rows = MIN_ROWS }) {
  return {
    report, keymap: KEYMAPS[keymap] ? keymap : 'ispf', cols, rows,
    stack: [{ panel: 'home' }], view: { ...DEFAULT_VIEW }, sel: 0, top: 0,
    cmd: '', cmdOpen: false, message: '',
  };
}

const current = (s) => s.stack[s.stack.length - 1];
const done = (state, effects = []) => ({ state, effects });
const replaceTop = (s, entry) => ({ ...s, stack: [...s.stack.slice(0, -1), entry] });

export function update(state, event) {
  if (event.type === 'resize') return done({ ...state, cols: event.cols, rows: event.rows });
  if (event.type !== 'key') return done(state);
  const t = event.token;
  const s = { ...state, message: '' };
  // Typing edits the command line: always under ISPF, under modern only after ':' or '/'.
  if (s.keymap === 'ispf' || s.cmdOpen) {
    if (t.startsWith('char:')) return done({ ...s, cmd: s.cmd + t.slice(5) });
    if (t === 'Backspace') return done({ ...s, cmd: s.cmd.slice(0, -1) });
    if (t === 'Enter' && s.cmd.trim()) return command({ ...s, cmd: '', cmdOpen: false }, s.cmd.trim());
    if ((t === 'Escape' || t === 'Enter') && s.cmdOpen) return done({ ...s, cmd: '', cmdOpen: false });
  }
  const action = actionFor(s.keymap, t);
  return action ? act(s, action, t) : done(s);
}

function act(s, action, token) {
  switch (action) {
    case 'quit': return done(s, [{ type: 'quit' }]);
    case 'end': return end(s);
    case 'help': return help(s);
    case 'command': return done({ ...s, cmdOpen: true, cmd: token === 'char:/' ? 'FIND ' : s.cmd });
    case 'open': return open(s);
    default: return move(s, action);
  }
}

function end(s) {
  if (s.stack.length === 1) return done(s, [{ type: 'quit' }]);
  return done({ ...s, stack: s.stack.slice(0, -1) });
}

function help(s) {
  const t = current(s);
  if (t.panel === 'help') return done(replaceTop(s, { ...t, keys: !t.keys, scroll: 0 }));
  return done({ ...s, stack: [...s.stack, { panel: 'help', of: t.panel, keys: false, scroll: 0 }] });
}

function open(s) {
  const t = current(s);
  if (t.panel === 'home') return done({ ...s, stack: [...s.stack, { panel: 'findings' }] });
  if (t.panel === 'findings') {
    const list = findingRows(s.report, s.view);
    if (!list.length) return done({ ...s, message: 'There is no finding to open in this view.' });
    return done({ ...s, stack: [...s.stack, { panel: 'finding', f: list[s.sel].f, scroll: 0 }] });
  }
  return done(s);
}

function move(s, action) {
  const t = current(s);
  if (t.panel === 'findings') {
    const n = findingRows(s.report, s.view).length;
    const page = Math.max(1, findingsLayout(s).height);
    const to = { up: s.sel - 1, down: s.sel + 1, pageUp: s.sel - page, pageDown: s.sel + page, top: 0, bottom: n - 1 }[action];
    const sel = Math.max(0, Math.min(n - 1, to ?? s.sel));
    let top = s.top;
    if (action === 'pageDown' || action === 'pageUp') top = Math.max(0, Math.min(Math.max(0, n - page), s.top + (to - s.sel)));
    if (sel < top) top = sel;
    if (sel >= top + page) top = sel - page + 1;
    return done({ ...s, sel: Math.max(0, sel), top: Math.max(0, top) });
  }
  if (t.panel === 'finding' || t.panel === 'help') {
    const page = Math.max(1, s.rows - 4);
    const delta = { up: -1, down: 1, pageUp: -page, pageDown: page, top: -Infinity, bottom: Infinity }[action] || 0;
    const max = Math.max(0, bodyLines(s, t).length - page);
    return done(replaceTop(s, { ...t, scroll: Math.max(0, Math.min(max, (t.scroll || 0) + delta)) }));
  }
  return done(s);
}

const SORT_WORDS = { SEV: 'severity', SEVERITY: 'severity', RULE: 'rule', PROGRAM: 'program', PGM: 'program', WHERE: 'where', FILE: 'where', PATH: 'where', EVIDENCE: 'evidence', EVID: 'evidence', EXPLOIT: 'exploit', EXPLOITABILITY: 'exploit' };

function command(s, text) {
  const [word, ...rest] = text.split(/\s+/);
  const verb = word.toUpperCase();
  const arg = rest.join(' ');
  const fresh = (view) => done({ ...s, view, sel: 0, top: 0 });
  switch (verb) {
    case 'HELP': return help(s);
    case 'END': return end(s);
    case '=X': case 'EXIT': case 'QUIT': return done(s, [{ type: 'quit' }]);
    case '1': case 'FINDINGS': {
      const at = s.stack.findIndex((t) => t.panel === 'findings');
      return done({ ...s, stack: at < 0 ? [...s.stack, { panel: 'findings' }] : s.stack.slice(0, at + 1) });
    }
    case 'TOP': return move(s, 'top');
    case 'BOTTOM': return move(s, 'bottom');
    case 'RESET': return fresh({ ...DEFAULT_VIEW });
    case 'SORT': {
      const key = SORT_WORDS[arg.toUpperCase()];
      return key ? fresh({ ...s.view, sort: key }) : done({ ...s, message: `SORT takes ${SORT_NAMES.join(', ')}.` });
    }
    case 'FILTER': {
      if (/^off$/i.test(arg)) return fresh({ ...s.view, evidence: null, exploit: null });
      const words = arg.toLowerCase().split(/[,\s]+/).filter(Boolean);
      const bad = words.filter((k) => !EVIDENCE_KINDS.includes(k) && !VERDICTS.includes(k));
      if (!words.length || bad.length) return done({ ...s, message: `FILTER takes an evidence kind or an exploitability verdict (F1 lists them), or OFF${bad.length ? `; not ${bad.join(', ')}` : ''}.` });
      const kinds = words.filter((k) => EVIDENCE_KINDS.includes(k));
      const verdicts = words.filter((k) => VERDICTS.includes(k));
      return fresh({ ...s.view, evidence: kinds.length ? kinds : null, exploit: verdicts.length ? verdicts : null });
    }
    case 'FIND':
      return arg ? fresh({ ...s.view, find: arg }) : done({ ...s, message: 'FIND needs the text to look for.' });
    case 'KEYS': {
      const k = arg.toLowerCase();
      return KEYMAPS[k] ? done({ ...s, keymap: k, message: `Keys are now ${k}.` }) : done({ ...s, message: `KEYS takes ${Object.keys(KEYMAPS).join(' or ')}.` });
    }
    default:
      return done({ ...s, message: `Command "${word}" not recognised. F1 lists the commands.` });
  }
}

export function view(state) {
  const { cols, rows } = state;
  const scr = createScreen(cols, rows);
  if (cols < MIN_COLS || rows < MIN_ROWS) {
    put(scr, 0, 1, 'cobolwork needs a terminal of at least 80x24;', 'warn');
    put(scr, 1, 1, `this one is ${cols}x${rows}. Enlarge it, or press Ctrl-C to leave.`);
    return scr;
  }
  const t = current(state);
  const drawn = DRAW[t.panel](scr, state, t);
  put(scr, 0, 0, ` COBOLWORK  ${drawn.title}`, 'title');
  if (drawn.right) put(scr, 0, cols - drawn.right.length - 1, drawn.right, 'title');
  styleRow(scr, 0, 'title');
  put(scr, 1, 0, ` Command ===> ${state.cmd}${state.cmdOpen ? '_' : ''}`);
  if (state.keymap === 'ispf') put(scr, 1, cols - 17, 'Scroll ===> PAGE');
  if (state.message) put(scr, rows - 2, 0, ` ${state.message}`, 'hi');
  else if (drawn.hint) put(scr, rows - 2, 0, ` ${drawn.hint}`, 'dim');
  put(scr, rows - 1, 0, LEGEND[state.keymap], 'dim');
  return scr;
}

function drawBanner(scr, report, row, max) {
  const b = banner(report);
  let shown = b.lines;
  if (shown.length > max) shown = [...b.lines.slice(0, max - 1), `... and ${b.lines.length - max + 1} more: Home lists every one`];
  shown.forEach((line, i) => {
    const text = i > 0 ? `   ${line}` : b.complete ? ` ${line}` : ` ! ${line}`;
    put(scr, row + i, 0, text, b.complete ? 'dim' : 'warn');
  });
  return row + shown.length;
}

function findingsLayout(s) {
  const b = banner(s.report);
  const bannerLines = Math.min(b.lines.length, 4);
  const listTop = 2 + bannerLines + 2;
  return { bannerLines, listTop, height: s.rows - 2 - listTop };
}

const pad = (text, width) => {
  const str = String(text ?? '');
  return str.length > width ? str.slice(0, width - 1) + '>' : str.padEnd(width);
};

const DRAW = {
  home(scr, s) {
    const r0 = drawBanner(scr, s.report, 2, s.rows - 12);
    const sum = s.report.summary;
    const accepted = sum.baseline && sum.baseline.suppressed ? `, and ${sum.baseline.suppressed} accepted by a baseline` : '';
    let r = r0 + 1;
    put(scr, r++, 1, `Findings  ${sum.findings ?? s.report.findings.length}${accepted}`);
    put(scr, r++, 1, countsLine(s.report));
    const exploit = exploitLine(s.report);
    if (exploit) put(scr, r++, 1, exploit, sum.byExploitability.exploitable ? 'warn' : undefined);
    const kinds = [['programs', sum.programFiles], ['copybooks', sum.copybookFiles], ['JCL', sum.jclFiles]].filter(([, n]) => n != null);
    put(scr, r++, 1, `Read      ${sum.filesScanned ?? '?'} file(s)${kinds.length ? `: ${kinds.map(([k, n]) => `${n} ${k}`).join(', ')}` : ''}`);
    r++;
    const sets = Object.entries(sum.bySet || {});
    if (sets.length && r < s.rows - 3) {
      put(scr, r++, 1, 'Rule set      Read  Unreadable  Stopped', 'dim');
      for (const [name, x] of sets) {
        if (r >= s.rows - 2) break;
        put(scr, r++, 1, `${pad(name, 12)}${String(x.filesScanned ?? '').padStart(6)}${String(x.filesUnreadable ?? '').padStart(12)}  ${x.stoppedBy || ''}`);
      }
    }
    return { title: 'Home', right: `${s.report.findings.length} finding(s)`, hint: 'Enter or 1: Findings.  F1: Help.  F3: Leave.' };
  },

  findings(scr, s) {
    const layout = findingsLayout(s);
    let r = drawBanner(scr, s.report, 2, 4);
    put(scr, r++, 1, countsLine(s.report));
    const whereW = 17, progW = 9;
    // The verdict needs room the rule name cannot give up at 80 columns, so only a wider terminal shows it.
    const exploitW = s.cols >= 100 ? 16 : 0;
    const ruleW = s.cols - 18 - progW - whereW - 1 - exploitW;
    const exploitCol = (text) => (exploitW ? `${pad(text, exploitW - 1)} ` : '');
    put(scr, r++, 0, `   Sv Evidence  ${exploitCol('Exploit')}X ${pad('Rule', ruleW)} ${pad('Program', progW)}${'Where'}`, 'dim');
    const list = findingRows(s.report, s.view);
    if (!list.length) put(scr, layout.listTop, 1, s.report.findings.length ? 'No finding matches this view. RESET shows them all.' : 'No findings.');
    for (let i = 0; i < layout.height && s.top + i < list.length; i++) {
      const at = s.top + i;
      const x = list[at];
      const row = layout.listTop + i;
      const mark = at === s.sel ? ' > ' : '   ';
      put(scr, row, 0, `${mark}${x.letter}  ${pad(x.evidence, 9)} ${exploitCol(x.exploit)}${x.cross ? 'X' : ' '} ${pad(x.rule, ruleW)} ${pad(x.program || '-', progW)}${pad(x.where, whereW)}`);
      if (at === s.sel) styleRow(scr, row, 'sel');
      else if (x.sev === 'crit' || x.sev === 'high') put(scr, row, 3, x.letter, x.sev);
    }
    const label = viewLabel(s.view);
    return {
      title: `Findings${label ? ` (${label})` : ''}`,
      right: list.length ? `Row ${s.sel + 1} of ${list.length}` : 'No rows',
      hint: 'Enter: open.  SORT, FILTER, FIND, RESET on the command line.',
    };
  },

  finding(scr, s, t) {
    const body = bodyLines(s, t);
    body.slice(t.scroll || 0, (t.scroll || 0) + s.rows - 4).forEach((line, i) => put(scr, 2 + i, 0, line));
    const list = findingRows(s.report, s.view);
    const at = list.findIndex((r) => r.f === t.f);
    return { title: 'Finding', right: at < 0 ? `not in this view of ${list.length}` : `${at + 1} of ${list.length}`, hint: 'F3: back to the list.  F7/F8: scroll.' };
  },

  help(scr, s, t) {
    const body = bodyLines(s, t);
    body.slice(t.scroll || 0, (t.scroll || 0) + s.rows - 4).forEach((line, i) => put(scr, 2 + i, 0, line));
    const of = t.keys ? `${s.keymap} keys` : PANEL_NAME[t.of];
    return { title: `Help: ${of}`, right: '', hint: t.keys ? 'F1: help for the panel.  F3: back.' : 'F1: the keys.  F3: back.' };
  },
};

const PANEL_NAME = { home: 'Home', findings: 'Findings', finding: 'Finding', help: 'Help' };

function wrap(text, width, indent = '') {
  const out = [];
  let line = '';
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (line && (line + ' ' + word).length > width) { out.push(line); line = indent + word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) out.push(line);
  return out;
}

function bodyLines(s, t) {
  const w = s.cols - 2;
  if (t.panel === 'help') {
    if (t.keys) {
      const map = KEYMAPS[s.keymap];
      return [` The ${s.keymap} keys. KEYS ISPF or KEYS MODERN switches.`, '',
        ...ACTIONS.map((a) => ` ${a.padEnd(10)} ${Object.entries(map).filter(([, v]) => v === a).map(([k]) => k.replace(/^char:/, '')).join('  ')}`)];
    }
    return HELP[t.of].flatMap((p) => (p ? wrap(p, w).map((l) => ` ${l}`) : ['']));
  }
  const { f } = t;
  const field = (label, value) => wrap(value, w - 11).map((l, i) => ` ${i ? ''.padEnd(10) : label.padEnd(10)}${l}`);
  const lines = [
    ...field('Rule', f.rule),
    ...field('Severity', `${f.sev} (${SEV_LETTER[f.sev] || '?'})${f.cwe ? `   ${f.cwe}` : ''}`),
    ...(f.guardedFrom ? field('Checked', `lowered from ${f.guardedFrom} by the check on ${f.guard.item} at ${f.guard.file}:${f.guard.line}`) : []),
    ...field('Evidence', `${f.evidence}: ${EVIDENCE[f.evidence] || ''}`),
    ...field('Who acts', WHO_ACTS[f.evidence] || 'not stated'),
    ...(f.exploitability ? [
      ...field('Exploit', `${f.exploitability.verdict}: ${EXPLOITABILITY[f.exploitability.verdict] || ''}`),
      ...(f.exploitability.because || []).flatMap((b, i) => wrap(`- ${b}`, w - 11, '  ').map((l, j) => ` ${(i || j ? '' : 'Because').padEnd(10)}${l}`)),
      ...(f.exploitability.unknown ? field('Unknown', f.exploitability.unknown) : []),
    ] : []),
    ...(f.program ? field('Program', `${f.program}${f.crossProgram ? '   crosses programs' : ''}${f.hops ? `   ${f.hops} hop(s)` : ''}`) : []),
    ...field('Where', `${f.path}:${f.line}`),
    ...field('Identity', f.fingerprint || 'none: this report predates fingerprints'),
    '',
    ...wrap(f.detail || '', w).map((l) => ` ${l}`),
  ];
  if (f.related && f.related.length) {
    lines.push('');
    for (const x of f.related) lines.push(...field('Related', `${x.path}:${x.line}  ${x.detail || ''}`));
  }
  if (f.trace && f.trace.length) {
    lines.push('', ' Trace', ...f.trace.map((h, i) => (h.elided ? `   ${h.via}` : `   ${String(i + 1).padStart(2)}  ${pad(h.program, 9)}${pad(h.item, 18)}${h.via}`)));
    lines.push('', ` Source for each hop: cobolwork explain <path> ${f.fingerprint || '<fingerprint>'}`);
  }
  return lines;
}

const HELP = {
  home: [
    'Home shows what the scan read before what it found.',
    '',
    'The lines under the command line are coverage: each rule set that fell short, and why. A count over files nobody read is not a clean result, so read them first.',
    '',
    'Enter, or the command 1, opens Findings.',
    '',
    'Commands: FINDINGS (or 1), KEYS ISPF or KEYS MODERN, HELP, END, and =X to leave.',
  ],
  findings: [
    'Findings lists every finding, critical first, then by rule.',
    '',
    'Sv is severity as a letter: C critical, H high, M medium, L low, I info. Evidence is the kind of claim a finding makes. X marks a path that crosses programs.',
    '',
    'Enter opens the selected finding. F7 and F8, or Page Up and Page Down, move a page.',
    '',
    'Commands:',
    '  SORT SEVERITY, RULE, PROGRAM, WHERE, EVIDENCE or EXPLOIT',
    `  FILTER one or more of ${EVIDENCE_KINDS.join(', ')}, or of ${VERDICTS.join(', ')}; FILTER OFF`,
    '  FIND text: rule, program, path or detail containing it',
    '  RESET: the whole list, by severity',
    '  TOP, BOTTOM, END, and =X to leave',
  ],
  finding: [
    'One finding: what the rule claims, who acts on it, and where.',
    '',
    'Evidence says what the tool established. A path was traced by reading the code, not by running it. Severity says how urgent it is; a check on the route lowers it one step and is named here.',
    '',
    'Exploit is whether an attacker can use a path: exploitable needs the estate to declare an entry that reaches it open to any user. Because lists the facts the verdict rests on; Unknown names the one that would move it.',
    '',
    'Identity is the fingerprint. It does not change when code moves above the finding, so a baseline or a later report can refer to it.',
    '',
    'cobolwork explain <path> <fingerprint> prints the trace with the source line of every hop.',
  ],
};
