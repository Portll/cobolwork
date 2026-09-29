// SPDX-License-Identifier: AGPL-3.0-or-later
// The CICS system definition, as DFHCSDUP reads it: DEFINE commands, each naming a resource and
// giving its attributes as KEYWORD(value), running on until the next command.
//
//   DEFINE TDQUEUE(JOBS) GROUP(CARDDEMO)
//          TYPE(EXTRA) DDNAME(INREADER) ...
//
// It is how a transient-data queue a program writes to becomes a DD the region opens, which is the
// link between EXEC CICS WRITEQ TD and the internal reader. This reads text and opens nothing; the
// caller reads the file through the source tree, so containment stays where it is enforced.

const COMMAND = /^\s*(DEFINE|ADD|ALTER|APPEND|COPY|DELETE|INITIALIZE|LIST|REMOVE|SCAN|SERVICE|UPGRADE|USERDEFINE|VERIFY)\b/i;

// { tdqueues: Map(name -> { type, ddname, indirect, line }),
//   transactions: Map(name -> { program, cmdsec, ressec, line }),
//   tcpipservices: Map(name -> { port, protocol, ssl, authenticate, transaction, line }),
//   urimaps: Map(name -> { usage, path, program, transaction, tcpipservice, line }) }
export function parseCsd(text) {
  const tdqueues = new Map();
  const transactions = new Map();
  const tcpipservices = new Map();
  const urimaps = new Map();
  const blocks = [];
  let cur = null;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\*/.test(line)) continue;
    if (COMMAND.test(line)) {
      cur = { line: i + 1, text: line };
      blocks.push(cur);
    } else if (cur) cur.text += ` ${line}`;
  }
  for (const b of blocks) {
    const head = /^\s*DEFINE\s+([A-Z]+)\s*\(\s*([^)\s]+)\s*\)/i.exec(b.text);
    if (!head) continue;
    const kind = head[1].toUpperCase();
    const name = head[2].toUpperCase();
    const attrs = new Map();
    // The value is bounded. Unbounded, an unbalanced `(` makes the engine scan to the end of the
    // block and backtrack once per following attribute, which is quadratic: 5.6s at 100KB and 130s
    // at 400KB of `a(`. This is the one parser here that runs over arbitrary unfiltered bytes - any
    // file holding a single DEFINE line is handed to it whole - so that cost is reachable by a file
    // nobody chose to scan. No CSD attribute value comes near 256 bytes.
    for (const m of b.text.slice(head[0].length).matchAll(/\b([A-Z0-9]+)\s*\(([^)]{0,256})\)/gi)) attrs.set(m[1].toUpperCase(), m[2].trim().toUpperCase());
    if (kind === 'TCPIPSERVICE') {
      // SSL is kept as written, including absent: CICS defaults it to NO, so a definition that says
      // nothing accepts cleartext exactly as one that says NO does. GenApp's listener says nothing.
      tcpipservices.set(name, {
        port: attrs.get('PORTNUMBER') || null,
        protocol: attrs.get('PROTOCOL') || null,
        ssl: attrs.get('SSL') || null,
        // Absent is NO, as for SSL: a request arrives under the region's default user.
        authenticate: attrs.get('AUTHENTICATE') || null,
        transaction: attrs.get('TRANSACTION') || null,
        line: b.line,
      });
    } else if (kind === 'URIMAP') {
      // PATH keeps its case: a URI path is case-sensitive, and it is printed, not compared.
      const path = /\bPATH\s*\(([^)]{0,256})\)/i.exec(b.text.slice(head[0].length));
      urimaps.set(name, {
        usage: attrs.get('USAGE') || null,
        path: path ? path[1].trim() : null,
        program: attrs.get('PROGRAM') || null,
        transaction: attrs.get('TRANSACTION') || null,
        tcpipservice: attrs.get('TCPIPSERVICE') || null,
        line: b.line,
      });
    } else if (kind === 'TDQUEUE') {
      tdqueues.set(name, { type: attrs.get('TYPE') || null, ddname: attrs.get('DDNAME') || null, indirect: attrs.get('INDIRECTNAME') || null, transid: attrs.get('TRANSID') || null, line: b.line });
    } else if (kind === 'TRANSACTION') {
      // The security attributes are kept because their absence means the same as NO: a caller that
      // re-read the file to find them would search on past the end of this definition into the
      // next one, which is how a CMDSEC(YES) on one transaction came to clear another.
      transactions.set(name, {
        program: attrs.get('PROGRAM') || null,
        cmdsec: attrs.get('CMDSEC') || null,
        ressec: attrs.get('RESSEC') || null,
        line: b.line,
      });
    }
  }
  return { tdqueues, transactions, tcpipservices, urimaps };
}

// The DD a queue is written to, following one INDIRECT hop. Null when the definition does not say:
// an intrapartition queue has no DD, and neither does a queue nobody defined.
export function ddOfQueue(csd, queue) {
  let q = csd.tdqueues.get(queue);
  if (q && q.type === 'INDIRECT' && q.indirect) q = csd.tdqueues.get(q.indirect);
  return q && q.type === 'EXTRA' ? q.ddname : null;
}
