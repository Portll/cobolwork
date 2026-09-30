// SPDX-License-Identifier: AGPL-3.0-or-later
// What a job does that no COBOL source shows. A step decides which program runs, under whose
// authority, against which dataset; an in-stream SYSIN carries commands that never appear in any
// program the scanner reads. The 2026-09-18 evaluation counted 27 JCL files carrying RACF or
// IDCAMS commands in-stream, so this is where a repository's privileged surface actually lives.
import { inScope, isJcl, isProgram, relPath } from '../sources.mjs';
import { report } from '../kernel/ruleset.mjs';
import { treeFor, noteUnread, noteUnparsed } from '../kernel/source-tree.mjs';
import { parseJcl, dispositionOf } from '../jcl.mjs';
import { ddGroups } from '../utilities.mjs';
import { loadSite, productionQualifierOf, SITE_FILE } from '../site.mjs';
import { loadPacks, programsOf } from '../packs.mjs';
import { eachWithinMemory } from '../kernel/memory.mjs';


// FTP is an outbound channel the flow engine does not model, and a job can open it with no program
// in the tree. Two claims, on different lines. The session: plain FTP sends the logon and the data
// unencrypted, a construct and CWE-319, medium because the FTP.DATA the client finds for itself may
// ask for TLS where the job does not. The transfer: a dataset the site calls production leaving the
// system, CWE-201 as the flow set's other channels are, and high because it is worse than the
// channel it takes - though a transfer can be the job's whole purpose, which is why it is not
// critical.
export const JCL_RULES = {
  'jcl-instream-credential': {
    sev: 'crit', evidence: 'construct', cwe: 'CWE-798',
    text: 'A password or pass phrase is set in in-stream job data',
    impact: 'Anyone who can read the repository reads the password, and it logs the job on wherever it is used',
    remedy: 'Remove the password from the job; take the credential from a secured facility (a RACF keyring or a protected NETRC), never from in-stream JCL',
  },
  'jcl-instream-security-command': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-284',
    text: 'In-stream job data issues security product commands that grant or alter authority',
    impact: "Anyone who can edit the job grants or alters authority when it runs, under the job's authority",
    remedy: 'Keep RACF or security-product commands out of application job streams; run them through a controlled, reviewed administration process',
  },
  'jcl-instream-destructive': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-284',
    text: 'In-stream job data deletes or overwrites a catalogued dataset',
    impact: 'Anyone who can edit the job deletes or overwrites a catalogued dataset when it runs',
    remedy: 'Remove the in-stream delete/define of a catalogued dataset, or gate it behind a controlled change; do not carry it in an application job',
  },
  'jcl-dlm-hides-instream': {
    sev: 'med', evidence: 'tampering', cwe: 'CWE-1427',
    text: 'In-stream data uses a non-default delimiter, so it does not end where a line-by-line reader expects',
    impact: 'A non-default DLM carries the stream past the /* a line-by-line reader stops at, so a reviewer or scanner sees less than what runs',
    remedy: 'Use the default delimiter, or make the DLM and where the stream really ends explicit to any reader',
  },
  'jcl-parm-is-an-entry-point': { sev: 'info', evidence: 'context', cwe: 'CWE-20', text: 'A step passes PARM= to a program in this tree, which the flow rules follow as an untrusted source' },
  'jcl-exec-pgm-unresolved': { sev: 'info', evidence: 'coverage', cwe: null, text: 'A step runs a program that is neither a system utility nor defined by any source in this tree' },
  'jcl-ftp-cleartext': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-319',
    text: 'A step runs FTP with no TLS option on its PARM or in its in-stream configuration, so its logon and data cross the network in cleartext',
    impact: 'The logon and the data cross the network in cleartext, readable by anyone on the path',
    remedy: 'Require TLS: -a TLS or -r TLS on the FTP PARM, or SECURE_MECHANISM TLS in the in-stream SYSFTPD',
  },
  'jcl-ftp-sends-production-dataset': {
    sev: 'high', evidence: 'construct', cwe: 'CWE-201',
    text: 'A step sends a dataset the estate calls production off the system by FTP',
    impact: 'A dataset the estate calls production leaves the system to the FTP partner',
    remedy: 'Confirm the transfer and its partner are authorized for production data, and send over a TLS session',
  },
  'control-cards-from-dataset': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-829',
    text: 'A utility step reads the commands it runs from a cataloged data set, so what it runs is not in the reviewed JCL',
    impact: 'Whoever can update that data set decides what the step runs the next time the job does, with the job\'s authority',
    remedy: 'Keep the commands in-stream where they are reviewed with the job, or put the data set under the same change control and write access as the job',
  },
  'sort-exit-named': {
    sev: 'med', evidence: 'construct', cwe: 'CWE-829',
    text: 'A DFSORT or ICETOOL step names an exit routine on a MODS statement, a load module the sort loads and runs',
    impact: 'The exit runs inside the sort with the step\'s authority and sees every record; whoever can replace that load module runs code in the job',
    remedy: 'Confirm the exit\'s load library is under change control with restricted write access, or remove the exit',
  },
  'tso-batch-runs-program': {
    sev: 'low', evidence: 'construct', cwe: 'CWE-78',
    text: 'A TSO batch step runs another program, CLIST, REXX exec or job from its in-stream commands',
    impact: 'What the step runs is decided by the commands, not the PGM= the job names, and runs with the job\'s TSO authority',
    remedy: 'Review what the commands run; name a program with PGM= where the step exists to run one',
  },
};

const TSO = new Set(['IKJEFT01', 'IKJEFT1A', 'IKJEFT1B']);
const SORTS = new Set(['SORT', 'ICEMAN', 'SYNCSORT']);
const CONTROL_DDS = [
  [TSO, ['SYSTSIN']], [new Set(['BPXBATCH']), ['STDPARM']], [new Set(['IDCAMS']), ['SYSIN']],
  [SORTS, ['SYSIN', 'DFSPARM']], [new Set(['ICETOOL']), ['TOOLIN', 'DFSPARM']],
  [new Set(['DSNTEP2', 'DSNTEP4', 'DSNTIAD']), ['SYSIN']],
];
const TSO_RUNS = /^\s*(CALL|EXEC|EX|SUBMIT|ISPSTART|RUN)\b/i;
// RUN PROGRAM(DSNTEP2) under the DSN command processor makes that step's SYSIN a program's SQL.
const RUNS_SQL_PROGRAM = /\bRUN\s+PROGRAM\s*\(\s*(DSNTEP2|DSNTEP4|DSNTIAD)\s*\)/i;

// Utilities whose commands come from a DD: a cataloged data set there is commands nobody reviewed
// with the job; a MODS exit is a load module the sort runs; TSO commands say what else runs.
function controlCardFindings(r, path, findings) {
  for (const step of r.steps) {
    const pgm = step.pgm ? step.pgm.toUpperCase() : null;
    if (!pgm) continue;
    const groups = ddGroups(step);
    const cards = (name) => (groups.get(name) || []).flatMap((dd) => dd.inStream || []);
    const ddNames = new Set(CONTROL_DDS.filter(([pgms]) => pgms.has(pgm)).flatMap(([, dds]) => dds));
    if (TSO.has(pgm) && cards('SYSTSIN').some((l) => RUNS_SQL_PROGRAM.test(l.text))) ddNames.add('SYSIN');
    for (const name of ddNames) {
      for (const dd of groups.get(name) || []) {
        if (dd.dsn && !dd.inStream && !dd.temporary) {
          findings.push({ rule: 'control-cards-from-dataset', path, line: dd.line, step: step.name,
            detail: `step ${step.name || '(unnamed)'} runs ${pgm} with its ${name} commands in ${dd.dsn}, which is not part of this job` });
        }
      }
    }
    if (SORTS.has(pgm) || pgm === 'ICETOOL') {
      for (const l of [...cards('SYSIN'), ...cards('DFSPARM')]) {
        const mods = /^\s*MODS\s+(.*)$/i.exec(l.text);
        if (!mods) continue;
        for (const ex of mods[1].matchAll(/\b(E\d\d)\s*=\s*\(\s*([A-Z$#@][A-Z0-9$#@]{0,7})/gi)) {
          findings.push({ rule: 'sort-exit-named', path, line: l.line, step: step.name, detail: `step ${step.name || '(unnamed)'} names ${ex[1].toUpperCase()} exit ${ex[2].toUpperCase()} on a MODS statement` });
        }
      }
    }
    if (TSO.has(pgm)) {
      const runs = cards('SYSTSIN').map((l) => TSO_RUNS.exec(l.text)).filter(Boolean).map((m) => m[1].toUpperCase());
      if (runs.length) {
        findings.push({ rule: 'tso-batch-runs-program', path, line: step.line, step: step.name,
          detail: `step ${step.name || '(unnamed)'} runs ${runs.length} TSO command(s) that start other work: ${[...new Set(runs)].join(', ')}` });
      }
    }
  }
}

// IBM's batch FTP client takes the host and its options on PARM, or the host as the first line of
// its input, reads subcommands from INPUT, and logs on from NETRC or from its input. CardDemo's job
// gives the same lines on SYSIN, which is read here when there is no INPUT, though the page below
// does not say the client falls back to it.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.4.0/com.ibm.zos.v2r4.halu001/ftpreq.htm
// A session is in cleartext unless something asks for TLS: -a TLS or -r TLS on PARM, or
// SECURE_MECHANISM TLS in an in-stream SYSFTPD. A SYSFTPD naming a data set is configuration this
// reader cannot see, so that step is not called cleartext either way.
//   https://www.ibm.com/docs/en/zos/2.1.0?topic=commands-ftp-command
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.4.0/com.ibm.zos.v2r4.halz002/ftp_cust_client_for_tls.htm
// PUT, MPUT and APPEND send local files, and IBM's capitals - PUt, MPut, APpend, LCd - are the
// shortest spellings. A local name in quotes is a whole data set name, //DD: names a DD of the
// step, and anything else hangs off the local working directory, which only a quoted LCD fixes.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/ftpsubcmd.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/put.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/mput.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/append.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/lcd.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/dd_name_support.htm
const FTP_SENDS = [[/^PUT?$/i, 'PUT'], [/^MP(?:UT?)?$/i, 'MPUT'], [/^AP(?:P(?:E(?:ND?)?)?)?$/i, 'APPEND']];

// Every subcommand on the page above, in IBM's spelling.
const FTP_SUBCOMMANDS = ['?', '!', 'ACCount', 'APpend', 'AUth', 'AScii', 'BIG5', 'BINary', 'BLock', 'CCc', 'CD',
  'CDUp', 'CLEar', 'CLose', 'COMpress', 'CProtect', 'CWd', 'DEBug', 'DELEte', 'DELImit', 'DIr', 'DUMP', 'EBcdic',
  'EUckanji', 'FEature', 'FIle', 'Get', 'GLob', 'HAngeul', 'HElp', 'Ibmkanji', 'JIS78kj', 'JIS83kj', 'Ksc5601',
  'LANGuage', 'LCd', 'LOCSIte', 'LOCSTat', 'LMkdir', 'LPwd', 'LS', 'MDelete', 'MGet', 'MKdir', 'MKFifo', 'MOde',
  'MPut', 'MVSGet', 'MVSPut', 'NOop', 'Open', 'PAss', 'PRIvate', 'PROMpt', 'PROTect', 'PROXy', 'PUt', 'PWd', 'QUIt',
  'QUOte', 'RECord', 'REName', 'REStart', 'RMdir', 'SAfe', 'SChinese', 'SENDPort', 'SENDSite', 'SIte', 'SJiskanji',
  'SRestart', 'STAtus', 'STREam', 'STRucture', 'SUnique', 'SYstem', 'TChinese', 'TSO', 'TYpe', 'UCs2', 'User', 'Verbose']
  .map((name) => ({ full: name.toUpperCase(), min: name.match(/^[^a-z]*/)[0].length }));
const subcommandOf = (word) => {
  const w = word.toUpperCase();
  const hit = FTP_SUBCOMMANDS.find((c) => w.length >= c.min && c.full.startsWith(w));
  return hit ? hit.full : null;
};
// A value that stands for a password rather than being one: a symbolic, a mask, or the word itself.
const PLACEHOLDER = /^(&.*|\*+|X+|\?+|<.*>|\{.*\}|PASSWORD|PASSWD|PWD|PASS|SECRET)$/i;

function ftpSession(step) {
  const dds = ddGroups(step);
  let host = null, tls = null;
  const words = (step.parm || '').split('(')[0].trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    if (/^-[ar]$/i.test(words[i])) {
      const mechanism = (words[++i] || '').toUpperCase();
      if (mechanism === 'TLS') tls = 'asked';
      else if (mechanism === 'NEVER' && !tls) tls = 'never';
    } else if (!words[i].startsWith('-') && !host) host = words[i];
  }
  let configUnread = null;
  for (const dd of dds.get('SYSFTPD') || []) {
    if (dd.inStream) { if (tls !== 'never' && dd.inStream.some((l) => /^\s*SECURE_MECHANISM\s+TLS\b/i.test(l.text))) tls = 'asked'; }
    else if (dd.dsn && !configUnread) configUnread = dd.dsn;
  }

  const input = dds.get('INPUT') || dds.get('SYSIN') || [];
  const hostLine = !host && input[0]?.inStream;
  let inputUnread = null, lcd = null, unixDir = false;
  const sends = [];
  // With no NETRC to answer for it, the client asks for a user ID and a password and in batch reads
  // them from its input after the host: "user password" on one line, or each on its own. A first
  // line that is a subcommand means something else answered, a NETRC the client found for itself.
  // USER and PASS give the same answers later in a session.
  let expect = dds.has('NETRC') ? null : 'logon', user = null;
  const passwords = [];
  const password = (dd, line, value) => { if (!PLACEHOLDER.test(value)) passwords.push({ dd, line, user }); };
  const local = (name) => {
    const dd = /^\/\/DD:([A-Z$#@][A-Z0-9$#@]{0,7})$/i.exec(name);
    if (dd) return { dd: dd[1].toUpperCase(), dsns: (dds.get(dd[1].toUpperCase()) || []).map((d) => d.dsn).filter(Boolean) };
    const quoted = /^'(.+)'$/.exec(name);
    if (quoted) return { dsns: [quoted[1].toUpperCase()] };
    if (name.startsWith('/') || unixDir) return { dsns: [] };
    return lcd ? { dsns: [`${lcd}.${name.toUpperCase()}`] } : { dsns: [], relative: name };
  };
  for (const dd of input) {
    if (!dd.inStream) { if (dd.dsn && !inputUnread) inputUnread = dd.dsn; continue; }
    for (const { line, text } of dd.inStream) {
      const [verb, ...args] = text.slice(0, 72).trim().split(/\s+/);
      if (!verb) continue;
      if (hostLine && !host) { host = verb; continue; }
      const sub = subcommandOf(verb);
      if (expect && !sub) {
        if (expect === 'logon') user = verb;
        if (expect === 'password') password(dd, line, verb);
        else if (args[0]) password(dd, line, args[0]);
        expect = expect === 'logon' && !args[0] ? 'password' : null;
        continue;
      }
      expect = null;
      if (sub === 'USER' && args[0]) {
        user = args[0];
        if (args[1]) password(dd, line, args[1]); else expect = 'password';
        continue;
      }
      if (sub === 'PASS' && args[0]) { password(dd, line, args[0]); continue; }
      if (/^LCD?$/i.test(verb) && args[0]) {
        const quoted = /^'(.+)'$/.exec(args[0]);
        unixDir = args[0].startsWith('/');
        lcd = quoted ? quoted[1].toUpperCase() : lcd && !unixDir ? `${lcd}.${args[0].toUpperCase()}` : null;
        continue;
      }
      const sent = FTP_SENDS.find(([re]) => re.test(verb));
      if (!sent) continue;
      for (const name of sent[1] === 'MPUT' ? args : args.slice(0, 1)) sends.push({ line, verb: sent[1], name, ...local(name) });
    }
  }
  const cleartext = tls === 'never' || (!tls && !configUnread);
  return { host, cleartext, configUnread, inputUnread, logon: dds.has('NETRC') ? 'NETRC' : null, sends, passwords, input };
}

// Credentials, which are the reason this rule set is critical rather than merely interesting.
// Each run of blanks follows the ( or = that separates it from the next, which keeps matching linear.
const CREDENTIAL = /\b(?:PASSWORD|PASSWRD|PHRASE|PASSPHRASE)\s*(?:\(\s*)?(?:=\s*)?['"]?([A-Z0-9@#$_.-]{3,})/i;

// Commands that grant, alter or remove authority, across the three security products in use on
// z/OS. Matching is on the command word at the start of a statement, because ADDUSER appearing in
// a comment or a report heading is not a command.
const SECURITY_COMMAND = /^\s*(?:TSS\s+)?(ADDUSER|ALTUSER|DELUSER|ADDGROUP|ALTGROUP|CONNECT|REMOVE|PERMIT|SETROPTS|RDEFINE|RALTER|RDELETE|ADDSD|ALTDSD|DELDSD|PASSWORD|ACFNRULE)\b/i;

// ACF2 speaks differently: a mode change followed by INSERT or CHANGE against a logonid.
const ACF2_COMMAND = /^\s*(?:SET\s+(?:LID|RULE|PROFILE)|INSERT\s+[A-Z0-9$#@]+|CHANGE\s+[A-Z0-9$#@]+\s)/i;

// Destruction in-stream. DELETE with a dataset name, or a REPRO that replaces its target. SQL's
// DELETE FROM removes rows through a database utility, not a catalogued dataset.
const DESTRUCTIVE = /^\s*(DELETE(?!\s+FROM\b)|ALTER\s+\S+\s+NEWNAME|REPRO\b[^\n]*\bREPLACE)\b/i;

// A dataset name as written in IDCAMS or on a DD. A symbol (&SYSUID, a procedure's &RLE) or a
// template's <USRHLQ> stands for a qualifier the job fills in, so it matches any one; the dot after a
// symbol ends it. An empty qualifier is a symbol the reader already filled with an empty default.
const dsnKey = (dsn) => String(dsn || '').replace(/^['(]+|[')]+$/g, '').replace(/\(.*$/, '').toUpperCase()
  .replace(/&[A-Z0-9@#$]+\.?/g, '*').replace(/<[^>]*>/g, '*').replace(/\.(?=\.)/g, '.*');
const dsnPattern = (k) => new RegExp(`^${k.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^.]+')}$`);

// The programs whose in-stream data can delete a catalogued dataset. A step running another known
// program reads its own control cards: DFHCSDUP's DELETE GROUP removes CICS definitions, and a
// database utility's DELETE FROM removes rows.
const DATASET_UTILITIES = new Set(['IDCAMS', 'IKJEFT01', 'IKJEFT1A', 'IKJEFT1B', 'ADRDSSU']);
const sameDsn = (a, b) => !!a && !!b && a !== '*' && b !== '*' && (a === b || dsnPattern(a).test(b) || dsnPattern(b).test(a));

const DSN_CHARS = "[A-Z0-9$#@&<>.\\-]";
// The dataset a destructive statement names: DELETE's first operand, which IDCAMS lets a
// continuation carry to the next line, ALTER's entry, or a REPRO's OUTDATASET, or the dataset on the
// DD its OUTFILE names.
function destroyedDsn(text, stepDds, next = '') {
  const del = new RegExp(`^\\s*DELETE\\s+\\(?\\s*'?(${DSN_CHARS}+)`, 'i').exec(text);
  if (del && del[1] !== '-') return dsnKey(del[1]);
  if (del || /^\s*DELETE\s*-?\s*$/i.test(text)) {
    const cont = new RegExp(`^\\s*\\(?\\s*'?(${DSN_CHARS}+)`, 'i').exec(next);
    return cont ? dsnKey(cont[1]) : null;
  }
  const alter = new RegExp(`^\\s*ALTER\\s+'?(${DSN_CHARS}+)`, 'i').exec(text);
  if (alter) return dsnKey(alter[1]);
  const ods = new RegExp(`\\b(?:OUTDATASET|ODS)\\s*\\(\\s*'?(${DSN_CHARS}+)`, 'i').exec(text);
  if (ods) return dsnKey(ods[1]);
  const ofile = /\b(?:OUTFILE|OFILE)\s*\(\s*([A-Z0-9$#@]+)/i.exec(text);
  const dd = ofile && stepDds.find((d) => String(d.name || '').toUpperCase() === ofile[1].toUpperCase());
  return dd && dd.dsn ? dsnKey(dd.dsn) : null;
}

// Whether the job that destroys a dataset makes it again: a clear-down before a rebuild or a reset
// of its own dataset, not the destruction of data the job does not own. Either a step other than
// IEFBR14 allocates it new, or in-stream IDCAMS defines it again under the same name.
function rebuilds(r, dsn) {
  if (!dsn) return false;
  for (const dd of r.dds) {
    const step = r.steps.find((s) => s.name === dd.step);
    const pgm = String(step?.pgm || '').toUpperCase();
    if (pgm && pgm !== 'IEFBR14' && dispositionOf(dd.disp)?.status === 'NEW' && sameDsn(dsnKey(dd.dsn), dsn)) return true;
  }
  const text = r.dds.filter((d) => d.inStream).flatMap((d) => d.inStream.map((l) => l.text)).join('\n');
  return [...text.matchAll(new RegExp(`\\bNAME\\s*\\(\\s*'?(${DSN_CHARS}+)`, 'gi'))].some((m) => sameDsn(dsnKey(m[1]), dsn));
}

// Programs the system supplies. A step naming one of these is ordinary, and reporting every
// IEFBR14 as an unresolved program would bury the finding this rule exists for.
const SYSTEM_PROGRAMS = new Set([
  'IEFBR14', 'IEBGENER', 'IEBCOPY', 'IEBUPDTE', 'IEBCOMPR', 'IEBPTPCH', 'IEBDG', 'IEBEDIT',
  'IDCAMS', 'IKJEFT01', 'IKJEFT1A', 'IKJEFT1B', 'IEHLIST', 'IEHPROGM', 'IEHINITT', 'IEHMOVE',
  'SORT', 'ICEMAN', 'ICETOOL', 'SYNCSORT', 'DFSORT', 'ADRDSSU', 'IEWL', 'IEWBLINK', 'HEWL',
  'IGYCRCTL', 'IGYWCL', 'ASMA90', 'IEV90', 'IKJEFTSR', 'IRRUT100', 'IRRUT200', 'IRRUT400',
  'IRRDBU00', 'ICKDSF', 'IEFBR14', 'FTP', 'DSNUTILB', 'DSNTEP2', 'DSNTIAD', 'DFHCSDUP',
  'CSQUTIL', 'CSQJU003', 'EZACFSM1', 'IOEAGFMT', 'BPXBATCH', 'JVMLDM86', 'PGM=*.DD',
]);

// The program names a tree defines, by PROGRAM-ID rather than by file name, because a member is
// called by the name it declares. Read with a regular expression rather than the full parser: this
// is a membership question over every program in the tree and does not need a data division.
// The `unread` list is the caller's: a program this cannot read is a program whose PROGRAM-ID is
// not in the set, so a step running it reads as unresolved. That is a claim about the tree, and it
// has to be attributable to a file rather than inferred from a silence. This catch previously
// discarded the error, and when a refactor left `tree` out of scope it turned a ReferenceError
// into an empty result.
function programIds(tree, files, unread) {
  const ids = new Set();
  for (const f of files) {
    let src;
    try { src = tree.text(f).text; } catch (e) { unread.push(`${tree.rel(f)}: ${e.code || e.name}`); continue; }
    for (const m of src.matchAll(/^[^*\n]{0,6}\s*PROGRAM-ID\s*\.\s*['"]?([A-Z0-9$#@_-]+)/gim)) {
      ids.add(m[1].toUpperCase());
    }
  }
  return ids;
}

export function scanJcl(root, opts = {}) {
  const tree = treeFor(root, opts);
  const all = tree.list().filter(inScope(opts));
  const jclFiles = all.filter(isJcl);
  const programsUnread = [];
  const defined = programIds(tree, all.filter(isProgram), programsUnread);

  // A vendor product supplies its own utilities. An estate that has loaded the pack for a product
  // is telling us those programs exist, so reporting them as undefined would be a false positive
  // created by the customer having told us the truth.
  const site = loadSite(root, opts.site || null);
  const { loaded } = loadPacks(opts.packs || site.vendorPacks || [], { allowUnvalidated: true });
  const vendorPrograms = programsOf(loaded);

  const findings = [];
  const stats = { filesScanned: 0, filesUnreadable: 0, jobs: 0, steps: 0, instreamStreams: 0,
    vendorProgramsKnown: vendorPrograms.size, coverageIncomplete: false,
    // A program whose PROGRAM-ID could not be read is a program a step may resolve to and this set
    // will not know it. Named, because the alternative is a jcl-exec-pgm-unresolved finding whose
    // real cause was a file nobody could open.
    ...(programsUnread.length ? { programsUnread, coverageIncomplete: true } : {}) };

  const run = eachWithinMemory(jclFiles, (f) => {
    let src;
    try { src = tree.text(f).text; } catch (e) { noteUnread(stats, tree, f, e); return 0; }
    const path = relPath(root, f);

    let r;
    try { r = parseJcl(src, f, { symbols: opts.symbols || {} }); } catch (e) { noteUnparsed(stats, tree, f, e); return src.length; }
    stats.filesScanned++;
    stats.jobs += r.jobs.length;
    stats.steps += r.steps.length;
    if (r.coverageIncomplete) {
      stats.coverageIncomplete = true;
      stats.filesReadInPart = (stats.filesReadInPart || 0) + 1;
      const d = r.diags.find((x) => x.sev === 'error') || r.diags.find((x) => x.sev === 'warn' && /INCLUDE|symbolic/.test(x.text));
      if (d && !stats.firstReadInPart) stats.firstReadInPart = `${path}${d.line ? `:${d.line}` : ''}: ${d.text}`;
    }

    const ftpSteps = new Map(r.steps.filter((s) => s.pgm && s.pgm.toUpperCase() === 'FTP' && !defined.has('FTP')).map((s) => [s, ftpSession(s)]));
    const ftpInput = new Map();
    for (const ftp of ftpSteps.values()) for (const dd of ftp.input) ftpInput.set(dd, ftp);

    for (const dd of r.dds) {
      if (!dd.inStream) continue;
      stats.instreamStreams++;

      if (dd.dlm) {
        findings.push({ rule: 'jcl-dlm-hides-instream', path, line: dd.line, step: dd.step,
          detail: `${dd.name || 'a DD'} in step ${dd.step || '(none)'} uses DLM=${dd.dlm}, so its ${dd.inStream.length} lines do not end at /*` });
      }

      const ftp = ftpInput.get(dd);
      for (const [at, l] of dd.inStream.entries()) {
        const text = l.text;
        const cred = text.match(CREDENTIAL);
        if (cred) {
          findings.push({ rule: 'jcl-instream-credential', path, line: l.line, step: dd.step,
            detail: `in-stream data sets ${cred[0].split(/[\s(=]/)[0].toUpperCase()} in ${dd.name || 'a DD'}, in a file anyone who can read the repository can read` });
          continue;   // one line is one finding, and the credential is the more serious reading
        }
        const logon = ftp && ftp.passwords.find((p) => p.dd === dd && p.line === l.line);
        if (logon) {
          findings.push({ rule: 'jcl-instream-credential', path, line: l.line, step: dd.step,
            detail: `in-stream FTP input gives the password ${logon.user ? `for ${logon.user} ` : ''}that step ${dd.step || '(none)'} logs on ${ftp.host ? `to ${ftp.host} ` : ''}with, in a file anyone who can read the repository can read` });
          continue;
        }
        const sec = text.match(SECURITY_COMMAND);
        if (sec) {
          findings.push({ rule: 'jcl-instream-security-command', path, line: l.line, step: dd.step,
            detail: `in-stream data issues ${sec[1].toUpperCase()}, which grants or alters authority, from step ${dd.step || '(none)'}` });
          continue;
        }
        if (ACF2_COMMAND.test(text)) {
          findings.push({ rule: 'jcl-instream-security-command', path, line: l.line, step: dd.step,
            detail: `in-stream data issues an ACF2 administration command from step ${dd.step || '(none)'}` });
          continue;
        }
        // FTP's DELETE removes a file on the remote host, not a catalogued dataset.
        const stepPgm = String(r.steps.find((s) => s.name === dd.step)?.pgm || '').toUpperCase();
        const del = !ftp && (!stepPgm || DATASET_UTILITIES.has(stepPgm)) && text.match(DESTRUCTIVE);
        if (del) {
          const target = destroyedDsn(text, r.dds.filter((d) => d.step === dd.step), dd.inStream[at + 1]?.text || '');
          const clearDown = rebuilds(r, target);
          const production = !clearDown && target && !target.includes('*') && productionQualifierOf(target, site.productionQualifiers);
          // The verb, never the rest of the line: a REPRO's line can carry anything, keys included.
          const verb = /^REPRO/i.test(del[1]) ? 'REPRO ... REPLACE' : /^ALTER/i.test(del[1]) ? 'ALTER ... NEWNAME' : 'DELETE';
          findings.push({ rule: 'jcl-instream-destructive', path, line: l.line, step: dd.step,
            ...(clearDown ? { sev: 'info', clearDown: true } : production ? { sev: 'high' } : {}),
            detail: `in-stream data runs ${verb} against a catalogued dataset in step ${dd.step || '(none)'}${clearDown ? ', and the same job makes it again: a clear-down before a rebuild'
              : production ? `, in the production qualifier ${production}` : ''}` });
        }
      }
    }

    for (const s of r.steps) {
      if (!s.pgm) continue;
      const pgm = s.pgm.toUpperCase();

      // PARM is the mainframe's argv. The flow engine now follows it into the program's first
      // LINKAGE item, so this row is not the finding - it is the inventory of where untrusted data
      // enters, which is worth having whether or not any of it reaches a sink.
      if (s.parm && defined.has(pgm)) {
        findings.push({ rule: 'jcl-parm-is-an-entry-point', path, line: s.line, step: s.name,
          detail: `step ${s.name} passes PARM= to ${pgm}, whose source is in this tree, so the flow rules treat that parameter as untrusted` });
      }

      if (!defined.has(pgm) && !SYSTEM_PROGRAMS.has(pgm) && !vendorPrograms.has(pgm) && !pgm.startsWith('*.')) {
        findings.push({ rule: 'jcl-exec-pgm-unresolved', path, line: s.line, step: s.name,
          detail: `step ${s.name} runs ${pgm}, which no source in this tree defines, which is not a system utility, and which no loaded vendor pack supplies` });
      }

      const ftp = ftpSteps.get(s);
      if (ftp) {
        const who = `step ${s.name || '(unnamed)'}`;
        const to = ftp.host ? `to ${ftp.host}` : 'to the host its input names';
        stats.ftpSteps = (stats.ftpSteps || 0) + 1;
        if (ftp.inputUnread) stats.ftpInputUnread = (stats.ftpInputUnread || 0) + 1;
        if (ftp.configUnread) stats.ftpConfigUnread = (stats.ftpConfigUnread || 0) + 1;
        const undecided = ftp.sends.filter((x) => x.relative).length;
        if (undecided) stats.ftpSendsUndecided = (stats.ftpSendsUndecided || 0) + undecided;

        if (ftp.cleartext) {
          const sent = ftp.sends.flatMap((x) => x.dsns);
          const what = sent.length ? `; it sends ${sent.join(', ')}`
            : ftp.inputUnread ? `; its subcommands are in ${ftp.inputUnread}, which this reader cannot see` : '';
          findings.push({ rule: 'jcl-ftp-cleartext', path, line: s.line, step: s.name,
            detail: `${who} runs FTP ${to} with no TLS option on its PARM or in an in-stream SYSFTPD, so its logon, ${ftp.logon ? 'from NETRC' : 'from its input'}, and its data cross the network in cleartext unless the FTP.DATA the client finds for itself requires TLS${what}` });
        }

        // One finding for each line that sends production data, however many datasets it names.
        const byLine = new Map();
        for (const x of ftp.sends) {
          if (!x.dsns.length) continue;
          if (!site.productionQualifiers.length) { stats.ftpSendsNotChecked = (stats.ftpSendsNotChecked || 0) + 1; continue; }
          for (const dsn of x.dsns) {
            const q = productionQualifierOf(dsn, site.productionQualifiers);
            if (!q) continue;
            if (!byLine.has(x.line)) byLine.set(x.line, { verb: x.verb, dsns: [], qualifiers: new Set() });
            byLine.get(x.line).dsns.push(dsn);
            byLine.get(x.line).qualifiers.add(q);
          }
        }
        for (const [line, hit] of byLine) {
          findings.push({ rule: 'jcl-ftp-sends-production-dataset', path, line, step: s.name,
            detail: `${who} sends ${hit.dsns.join(', ')} ${to} by FTP ${hit.verb}, and ${[...hit.qualifiers].join(', ')} is a production qualifier${ftp.cleartext ? ', over a session with no TLS option' : ''}` });
        }
      }
    }
    controlCardFindings(r, path, findings);
    return src.length;
  }, { label: 'jcl', maxBytes: opts.maxSourceBytes ?? Infinity });

  // Without production qualifiers the transfer rule has not looked, which is not a clean result.
  if (stats.ftpSendsNotChecked) {
    stats.setIncomplete = true;
    stats.notLooked = [`${stats.ftpSendsNotChecked} FTP transfer(s) send a named dataset, and ${SITE_FILE} names no production qualifier, so the production-data rule did not run on them`];
  }
  // With qualifiers declared, a local name relative to a prefix the job does not show names no
  // dataset, so it is the one send the rule cannot judge. The case above needs no qualifiers, so
  // the two never both apply.
  if (stats.ftpSendsUndecided && site.productionQualifiers.length) {
    stats.setIncomplete = true;
    stats.notLooked = [`${stats.ftpSendsUndecided} FTP transfer(s) name the local dataset relative to a prefix the job does not show, so whether each sends production data was not judged`];
  }

  // coverageIncomplete is already true here when the JCL parser could not resolve an INCLUDE or
  // a symbolic. report() ORs rather than overwrites, so that claim survives.
  if (stats.filesReadInPart) {
    stats.readInPart = `${stats.filesReadInPart} JCL file(s) were read in part - an INCLUDE not resolved, a symbolic with no value, or a statement that did not parse`
      + (stats.firstReadInPart ? `; the first is ${stats.firstReadInPart}` : '');
  }
  return report('jcl', { rules: JCL_RULES, findings, stats, run });
}
