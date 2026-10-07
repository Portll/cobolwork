// SPDX-License-Identifier: AGPL-3.0-or-later
// The environment variables a literal shell command reads, and whether each is read as one argument
// the shell never parses.
//
// A variable inside double quotes expands to one word, and the shell does not read what it holds as
// syntax: no command substitution, no redirection, no second command. That holds only where the
// word is an argument of a simple command whose program is named by literal text and does not run
// its arguments itself. A quoted variable as the program, or as an argument of a shell, of eval, of
// an interpreter or of a program that runs another (env, xargs, sudo), is still run.

// Programs that run their arguments, or one of them, as a command or a script.
const RUNS_ARGUMENTS = new Set(`sh bash dash ksh mksh zsh csh tcsh fish ash busybox eval exec source . env xargs
sudo su doas runuser chroot nohup nice ionice time timeout watch strace ltrace command builtin trap
awk gawk mawk nawk perl python python2 python3 ruby node nodejs php lua tclsh expect find parallel
ssh rsh rexec screen tmux script bsub qsub at batch crontab git make cmd powershell pwsh osascript`.split(/\s+/));

// Reserved words a command can follow, and those that begin something other than a simple command.
const LEADS_A_COMMAND = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{']);
const NOT_A_COMMAND = new Set(['for', 'case', 'select', 'function', 'coproc', '[[', '((', 'in', 'fi', 'done', 'esac', '}']);

// Characters that end a simple command or start a compound one when the shell reads them unquoted.
const SEPARATORS = new Set([';', '&', '|', '(', ')', '\n']);

// Each `$NAME` or `${NAME}` the command reads, in order: { name, parameterised }.
// `parameterised` is true only where the reference is inside double quotes, in a word that is an
// argument (not the program, not a redirection's target) of a simple command whose program is
// literal text and not one of RUNS_ARGUMENTS, and outside any command substitution.
export function environmentReads(command) {
  const reads = [];
  const text = String(command);
  let words = [];
  let word = null;
  let redirect = false;
  let i = 0;
  const startWord = () => { if (!word) word = { text: '', refs: [], literal: true, redirect }; redirect = false; };
  const endWord = () => { if (word) { words.push(word); word = null; } };
  const endCommand = () => {
    endWord();
    const args = words.filter((w) => !w.redirect);
    let at = 0;
    while (at < args.length && args[at].literal && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(args[at].text) || LEADS_A_COMMAND.has(args[at].text))) at++;
    const program = args[at];
    const name = program && program.literal ? program.text.replace(/^.*\//, '') : null;
    const safeProgram = !!name && !RUNS_ARGUMENTS.has(name) && !NOT_A_COMMAND.has(name);
    for (const w of words) {
      for (const r of w.refs) {
        const argument = !w.redirect && w !== program && args.indexOf(w) > at;
        reads.push({ name: r.name, parameterised: r.quoted && !r.substituted && argument && safeProgram });
      }
    }
    words = [];
  };
  const reference = (quoted, substituted) => {
    // At a `$`: a name, a braced name, or something that is not a variable read.
    const rest = text.slice(i + 1);
    const m = /^\{([A-Za-z_][A-Za-z0-9_]*)\}/.exec(rest) || /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest);
    if (!m) return false;
    startWord();
    word.refs.push({ name: m[1], quoted, substituted });
    word.literal = false;
    word.text += m[0];
    i += 1 + m[0].length;
    return true;
  };
  let substitution = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '\\' && i + 1 < text.length) { startWord(); word.text += text[i + 1]; i += 2; continue; }
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      startWord();
      word.text += text.slice(i + 1, end < 0 ? text.length : end);
      i = end < 0 ? text.length : end + 1;
      continue;
    }
    if (c === '"') {
      startWord();
      i++;
      while (i < text.length && text[i] !== '"') {
        if (text[i] === '\\' && i + 1 < text.length) { word.text += text[i + 1]; i += 2; continue; }
        if (text[i] === '`' || (text[i] === '$' && text[i + 1] === '(')) { substitution++; word.literal = false; word.text += text[i]; i++; continue; }
        if (text[i] === ')' && substitution) { substitution--; word.text += text[i]; i++; continue; }
        if (text[i] === '$' && reference(true, substitution > 0)) continue;
        word.text += text[i];
        i++;
      }
      i++;
      continue;
    }
    if (c === '$' && text[i + 1] === '(') { substitution++; startWord(); word.literal = false; word.text += '$('; i += 2; continue; }
    if (c === '`') { substitution = substitution ? substitution - 1 : substitution + 1; startWord(); word.literal = false; i++; continue; }
    if (c === '$' && reference(false, substitution > 0)) continue;
    if (c === ')' && substitution) { substitution--; word.text += c; i++; continue; }
    // Inside a substitution everything is part of the one word it makes.
    if (substitution) { word.text += c; i++; continue; }
    if (c === '>' || c === '<') { endWord(); redirect = true; i++; while (text[i] === '>' || text[i] === '&' || text[i] === '|') i++; continue; }
    if (SEPARATORS.has(c)) { endCommand(); i++; continue; }
    if (c === ' ' || c === '\t') { endWord(); i++; continue; }
    startWord();
    word.text += c;
    i++;
  }
  endCommand();
  return reads;
}
