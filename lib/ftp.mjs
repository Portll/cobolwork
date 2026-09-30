// SPDX-License-Identifier: AGPL-3.0-or-later
import { statementCard } from './cards.mjs';

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
// Get and MGet copy remote files in, each to the local name given or, with none, to the foreign
// file's own name, placed as a sent name is. SIte FILETYPE=JES makes the remote host submit what
// is sent as a job and return job output to a Get; FILETYPE=SQL makes it run a query. Either holds
// for the transfers after it, until another FILETYPE.
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/get.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/mget.htm
//   https://www.ibm.com/docs/api/v1/content/SSLTBW_2.2.0/com.ibm.zos.v2r2.halu001/site.htm
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

// The session one FTP step runs, from its DDs grouped by name (ddGroups in lib/utilities.mjs).
export function ftpSession(step, dds) {
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
  const sends = [], gets = [];
  let filetype = null;
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
      const [verb, ...args] = statementCard(text).text.trim().split(/\s+/);
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
      const site = sub === 'SITE' ? args : sub === 'QUOTE' && subcommandOf(args[0] || '') === 'SITE' ? args.slice(1) : null;
      if (site) {
        for (const a of site) { const t = /^FILE(?:T(?:Y(?:P(?:E)?)?)?)?=(\w+)$/i.exec(a); if (t) filetype = t[1].toUpperCase() === 'SEQ' ? null : t[1].toUpperCase(); }
        continue;
      }
      const typed = filetype ? { filetype } : {};
      if (sub === 'GET' && args[0]) {
        const to = args[1] && !args[1].startsWith('(') ? args[1] : args[0];
        gets.push({ line, verb: 'GET', name: args[0], ...typed, ...local(to) });
        continue;
      }
      if (sub === 'MGET') {
        for (const name of args.filter((a) => !a.startsWith('(') && !/[*?]/.test(a))) gets.push({ line, verb: 'MGET', name, ...typed, ...local(name) });
        continue;
      }
      const sent = FTP_SENDS.find(([re]) => re.test(verb));
      if (!sent) continue;
      const foreign = sent[1] !== 'MPUT' && args[1] && !args[1].startsWith('(') ? args[1] : null;
      for (const name of sent[1] === 'MPUT' ? args : args.slice(0, 1)) sends.push({ line, verb: sent[1], name, foreign: foreign || name, ...typed, ...local(name) });
    }
  }
  const cleartext = tls === 'never' || (!tls && !configUnread);
  return { host, cleartext, configUnread, inputUnread, logon: dds.has('NETRC') ? 'NETRC' : null, sends, gets, passwords, input };
}
