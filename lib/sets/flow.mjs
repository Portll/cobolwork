// SPDX-License-Identifier: AGPL-3.0-or-later
import { analyze } from '../dataflow.mjs';
import { FLOW_MODEL, SCHEMA_VERSION, TOOL_VERSION } from '../version.mjs';
import { finish, withMeta, sortFindings } from '../kernel/findings.mjs';

// Other uses of the same index listed on a finding; the count of the rest is alsoUses.
const ALSO_LISTED = 25;

export const RULES = {
  'argv-or-env-to-os-command': { sev: 'crit', evidence: 'path', cwe: 'CWE-78', text: 'Command-line or environment input reaches an operating-system command routine' },
  'cics-terminal-to-os-command': { sev: 'crit', evidence: 'path', cwe: 'CWE-78', text: 'Terminal input reaches an operating-system command routine' },
  'cics-web-to-os-command': { sev: 'crit', evidence: 'path', cwe: 'CWE-78', text: 'Web input reaches an operating-system command routine' },
  'file-record-to-os-command': { sev: 'high', evidence: 'path', cwe: 'CWE-78', text: 'A file record reaches an operating-system command routine' },
  'database-to-os-command': { sev: 'high', evidence: 'path', cwe: 'CWE-78', text: 'A database value reaches an operating-system command routine' },
  'argv-or-env-to-dynamic-sql': { sev: 'high', evidence: 'path', cwe: 'CWE-89', text: 'Command-line or environment input reaches dynamic SQL' },
  'cics-terminal-to-dynamic-sql': { sev: 'crit', evidence: 'path', cwe: 'CWE-89', text: 'Terminal input reaches dynamic SQL' },
  'cics-web-to-dynamic-sql': { sev: 'crit', evidence: 'path', cwe: 'CWE-89', text: 'Web input reaches dynamic SQL' },
  'file-record-to-dynamic-sql': { sev: 'high', evidence: 'path', cwe: 'CWE-89', text: 'A file record reaches dynamic SQL' },
  'database-to-dynamic-sql': { sev: 'high', evidence: 'path', cwe: 'CWE-89', text: 'A database value reaches dynamic SQL' },
  'argv-or-env-to-cics-dynamic-transfer': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'Command-line or environment input decides which program CICS transfers to' },
  'cics-terminal-to-cics-dynamic-transfer': { sev: 'crit', evidence: 'path', cwe: 'CWE-470', text: 'Terminal input decides which program CICS transfers to' },
  'cics-web-to-cics-dynamic-transfer': { sev: 'crit', evidence: 'path', cwe: 'CWE-470', text: 'Web input decides which program CICS transfers to' },
  'file-record-to-cics-dynamic-transfer': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'A file record decides which program CICS transfers to' },
  'database-to-cics-dynamic-transfer': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'A database value decides which program CICS transfers to' },
  'argv-or-env-to-dynamic-program-load': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'Command-line or environment input decides which program is called' },
  'cics-terminal-to-dynamic-program-load': { sev: 'crit', evidence: 'path', cwe: 'CWE-470', text: 'Terminal input decides which program is called' },
  'cics-web-to-dynamic-program-load': { sev: 'crit', evidence: 'path', cwe: 'CWE-470', text: 'Web input decides which program is called' },
  'file-record-to-dynamic-program-load': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'A file record decides which program is called' },
  'database-to-dynamic-program-load': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'A database value decides which program is called' },
  // A program opening the file its own user named acts with that user's authority, which is every
  // one read in the 500-repository corpus; it escalates only where the estate says the entry that
  // starts it runs privileged.
  'argv-or-env-to-dynamic-file-path': { sev: 'low', whenPrivileged: 'high', evidence: 'path', cwe: 'CWE-73', text: 'Command-line or environment input decides which file is opened' },
  'cics-terminal-to-dynamic-file-path': { sev: 'high', evidence: 'path', cwe: 'CWE-73', text: 'Terminal input decides which file is opened' },
  'cics-web-to-dynamic-file-path': { sev: 'high', evidence: 'path', cwe: 'CWE-73', text: 'Web input decides which file is opened' },
  'file-record-to-dynamic-file-path': { sev: 'med', evidence: 'path', cwe: 'CWE-73', text: 'A file record decides which file is opened' },
  'database-to-dynamic-file-path': { sev: 'med', evidence: 'path', cwe: 'CWE-73', text: 'A database value decides which file is opened' },
  // A JCL step is the entry point above the program. PARM is the mainframe's argv, and in-stream
  // data is a payload sitting in the repository: both are edited by anyone who can commit, so they
  // are untrusted in the same sense ACCEPT FROM COMMAND-LINE is, and carry the same severities.
  'jcl-parm-to-os-command': { sev: 'crit', evidence: 'path', cwe: 'CWE-78', text: 'A JCL PARM reaches an operating-system command routine' },
  'jcl-parm-to-dynamic-sql': { sev: 'high', evidence: 'path', cwe: 'CWE-89', text: 'A JCL PARM reaches dynamic SQL' },
  'jcl-parm-to-cics-dynamic-transfer': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'A JCL PARM decides which program CICS transfers to' },
  'jcl-parm-to-dynamic-program-load': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'A JCL PARM decides which program is called' },
  'jcl-parm-to-dynamic-file-path': { sev: 'high', evidence: 'path', cwe: 'CWE-73', text: 'A JCL PARM decides which file is opened' },
  'jcl-instream-to-os-command': { sev: 'crit', evidence: 'path', cwe: 'CWE-78', text: 'In-stream job data reaches an operating-system command routine' },
  'jcl-instream-to-dynamic-sql': { sev: 'high', evidence: 'path', cwe: 'CWE-89', text: 'In-stream job data reaches dynamic SQL' },
  'jcl-instream-to-cics-dynamic-transfer': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'In-stream job data decides which program CICS transfers to' },
  'jcl-instream-to-dynamic-program-load': { sev: 'high', evidence: 'path', cwe: 'CWE-470', text: 'In-stream job data decides which program is called' },
  'jcl-instream-to-dynamic-file-path': { sev: 'high', evidence: 'path', cwe: 'CWE-73', text: 'In-stream job data decides which file is opened' },
  // The internal reader runs what it is given as a job, under the authority of whoever submitted
  // it - for a CICS program, the region. Input reaching it is the platform's command injection. A
  // file record or database value reaching it is medium rather than high: reading JCL skeletons
  // from a dataset and submitting them is how an ordinary job submitter works, and the exposure is
  // whoever can write that dataset.
  'argv-or-env-to-internal-reader': { sev: 'crit', evidence: 'path', cwe: 'CWE-77', text: 'Command-line or environment input is written into a job the internal reader submits' },
  'cics-terminal-to-internal-reader': { sev: 'crit', evidence: 'path', cwe: 'CWE-77', text: 'Terminal input is written into a job the internal reader submits' },
  'cics-web-to-internal-reader': { sev: 'crit', evidence: 'path', cwe: 'CWE-77', text: 'Web input is written into a job the internal reader submits' },
  'file-record-to-internal-reader': { sev: 'med', evidence: 'path', cwe: 'CWE-77', text: 'A file record is written into a job the internal reader submits' },
  'database-to-internal-reader': { sev: 'med', evidence: 'path', cwe: 'CWE-77', text: 'A database value is written into a job the internal reader submits' },
  'jcl-parm-to-internal-reader': { sev: 'crit', evidence: 'path', cwe: 'CWE-77', text: 'A JCL PARM is written into a job the internal reader submits' },
  'jcl-instream-to-internal-reader': { sev: 'crit', evidence: 'path', cwe: 'CWE-77', text: 'In-stream job data is written into a job the internal reader submits' },
  // The CICS application API as an attack surface. CICS escapes nothing it sends and validates no
  // name it is given, so the program owns all of it. No other scanner reads these commands.
  'cics-web-to-web-response': { sev: 'high', evidence: 'path', cwe: 'CWE-79', text: 'Web input is written into the response this program returns' },
  'cics-terminal-to-web-response': { sev: 'high', evidence: 'path', cwe: 'CWE-79', text: 'Terminal input is written into the response this program returns' },
  'file-record-to-web-response': { sev: 'med', evidence: 'path', cwe: 'CWE-79', text: 'A file record is written into the response this program returns' },
  'database-to-web-response': { sev: 'med', evidence: 'path', cwe: 'CWE-79', text: 'A database value is written into the response this program returns' },
  'cics-web-to-http-header': { sev: 'high', evidence: 'path', cwe: 'CWE-113', text: 'Web input is written into a header of the response' },
  'cics-terminal-to-http-header': { sev: 'high', evidence: 'path', cwe: 'CWE-113', text: 'Terminal input is written into a header of the response' },
  'file-record-to-http-header': { sev: 'med', evidence: 'path', cwe: 'CWE-113', text: 'A file record is written into a header of the response' },
  'database-to-http-header': { sev: 'med', evidence: 'path', cwe: 'CWE-113', text: 'A database value is written into a header of the response' },
  'cics-web-to-outbound-host': { sev: 'high', evidence: 'path', cwe: 'CWE-918', text: 'Web input decides the host or path this program sends a request to' },
  'cics-terminal-to-outbound-host': { sev: 'high', evidence: 'path', cwe: 'CWE-918', text: 'Terminal input decides the host or path this program sends a request to' },
  'file-record-to-outbound-host': { sev: 'med', evidence: 'path', cwe: 'CWE-918', text: 'A file record decides the host or path this program sends a request to' },
  'database-to-outbound-host': { sev: 'med', evidence: 'path', cwe: 'CWE-918', text: 'A database value decides the host or path this program sends a request to' },
  'cics-web-to-queue-name': { sev: 'high', evidence: 'path', cwe: 'CWE-99', text: 'Web input names the queue a command reads, writes or deletes' },
  'cics-terminal-to-queue-name': { sev: 'high', evidence: 'path', cwe: 'CWE-99', text: 'Terminal input names the queue a command reads, writes or deletes' },
  'file-record-to-queue-name': { sev: 'med', evidence: 'path', cwe: 'CWE-99', text: 'A file record names the queue a command reads, writes or deletes' },
  'database-to-queue-name': { sev: 'med', evidence: 'path', cwe: 'CWE-99', text: 'A database value names the queue a command reads, writes or deletes' },
  // Where a statement reads or writes, decided by input from outside. Without SSRANGE, which is not
  // the Enterprise COBOL default, an index out of range reads or writes the storage beside the
  // table; with it, the program abends. File records and database values are not followed here:
  // in batch COBOL nearly every subscript descends from one, and that volume is unmeasured.
  'argv-or-env-to-subscript': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'Command-line or environment input is used as a subscript' },
  'cics-terminal-to-subscript': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'Terminal input is used as a subscript' },
  'cics-web-to-subscript': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'Web input is used as a subscript' },
  'jcl-parm-to-subscript': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'A JCL PARM is used as a subscript' },
  'jcl-instream-to-subscript': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'In-stream job data is used as a subscript' },
  'argv-or-env-to-reference-modification': { sev: 'high', evidence: 'path', cwe: 'CWE-1285', text: 'Command-line or environment input decides where a reference modification starts or how long it is' },
  'cics-terminal-to-reference-modification': { sev: 'high', evidence: 'path', cwe: 'CWE-1285', text: 'Terminal input decides where a reference modification starts or how long it is' },
  'cics-web-to-reference-modification': { sev: 'high', evidence: 'path', cwe: 'CWE-1285', text: 'Web input decides where a reference modification starts or how long it is' },
  'jcl-parm-to-reference-modification': { sev: 'high', evidence: 'path', cwe: 'CWE-1285', text: 'A JCL PARM decides where a reference modification starts or how long it is' },
  'jcl-instream-to-reference-modification': { sev: 'high', evidence: 'path', cwe: 'CWE-1285', text: 'In-stream job data decides where a reference modification starts or how long it is' },
  'argv-or-env-to-occurs-depending-count': { sev: 'high', evidence: 'path', cwe: 'CWE-1284', text: 'Command-line or environment input decides how many entries an OCCURS DEPENDING ON table holds' },
  'cics-terminal-to-occurs-depending-count': { sev: 'high', evidence: 'path', cwe: 'CWE-1284', text: 'Terminal input decides how many entries an OCCURS DEPENDING ON table holds' },
  'cics-web-to-occurs-depending-count': { sev: 'high', evidence: 'path', cwe: 'CWE-1284', text: 'Web input decides how many entries an OCCURS DEPENDING ON table holds' },
  'jcl-parm-to-occurs-depending-count': { sev: 'high', evidence: 'path', cwe: 'CWE-1284', text: 'A JCL PARM decides how many entries an OCCURS DEPENDING ON table holds' },
  'jcl-instream-to-occurs-depending-count': { sev: 'high', evidence: 'path', cwe: 'CWE-1284', text: 'In-stream job data decides how many entries an OCCURS DEPENDING ON table holds' },
  'argv-or-env-to-loop-bound': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'Command-line or environment input decides how far a loop that subscripts a table runs' },
  'cics-terminal-to-loop-bound': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'Terminal input decides how far a loop that subscripts a table runs' },
  'cics-web-to-loop-bound': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'Web input decides how far a loop that subscripts a table runs' },
  'jcl-parm-to-loop-bound': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'A JCL PARM decides how far a loop that subscripts a table runs' },
  'jcl-instream-to-loop-bound': { sev: 'high', evidence: 'path', cwe: 'CWE-129', text: 'In-stream job data decides how far a loop that subscripts a table runs' },
  // Bytes that are not decimal digits in a zoned or packed operand abend the program: an outage of
  // the transaction or the job, not a corruption, and a caller at a terminal or a browser can cause
  // one at will. Whoever edits a job or a command line abends only their own run.
  'cics-terminal-to-arithmetic': { sev: 'med', evidence: 'path', cwe: 'CWE-1287', text: 'Terminal input reaches arithmetic on a decimal field, where bytes that are not digits abend the program' },
  // A log line is a record, and a reader that prints or converts it breaks lines where the data says
  // to: a modified 3270 client or a web request can put X'15' or CR LF in a field. Low, because it
  // misleads whoever reads the log rather than changing what the program does.
  'cics-terminal-to-log': { sev: 'low', evidence: 'path', cwe: 'CWE-117', text: 'Terminal input is written to a log unchecked, where control characters in it can start a line the program did not write' },
  'cics-web-to-log': { sev: 'low', evidence: 'path', cwe: 'CWE-117', text: 'Web request data is written to a log unchecked, where control characters in it can start a line the program did not write' },
  // Storage acquired with a length the caller chose: in a CICS region the storage is shared by every
  // task, where a job's own PARM or command line exhausts only its own address space.
  'cics-terminal-to-storage-length': { sev: 'med', evidence: 'path', cwe: 'CWE-770', text: 'Terminal input decides how much storage the program acquires' },
  'cics-web-to-storage-length': { sev: 'med', evidence: 'path', cwe: 'CWE-770', text: 'Web input decides how much storage the program acquires' },
  'argv-or-env-to-storage-length': { sev: 'low', evidence: 'path', cwe: 'CWE-770', text: 'Command-line or environment input decides how much storage the program acquires' },
  'jcl-parm-to-storage-length': { sev: 'low', evidence: 'path', cwe: 'CWE-770', text: 'A JCL PARM decides how much storage the program acquires' },
  'jcl-instream-to-storage-length': { sev: 'low', evidence: 'path', cwe: 'CWE-770', text: 'In-stream job data decides how much storage the program acquires' },
  // The database or queue manager a program connects to, chosen by its caller: CVE-2024-52899 is the
  // JDBC shape of this in an IBM product. A job's own PARM reaches only what its submitter could.
  'cics-terminal-to-connection-target': { sev: 'med', evidence: 'path', cwe: 'CWE-99', text: 'Terminal input names the database or queue manager the program connects to' },
  'cics-web-to-connection-target': { sev: 'med', evidence: 'path', cwe: 'CWE-99', text: 'Web input names the database or queue manager the program connects to' },
  'argv-or-env-to-connection-target': { sev: 'low', evidence: 'path', cwe: 'CWE-99', text: 'Command-line or environment input names the database or queue manager the program connects to' },
  'jcl-parm-to-connection-target': { sev: 'low', evidence: 'path', cwe: 'CWE-99', text: 'A JCL PARM names the database or queue manager the program connects to' },
  'jcl-instream-to-connection-target': { sev: 'low', evidence: 'path', cwe: 'CWE-99', text: 'In-stream job data names the database or queue manager the program connects to' },
  // Routing by input. A SYSID ships the request to another region, which applies its own link
  // security; an EXEC CICS SET changes a region's resources with system-programming authority.
  'cics-terminal-to-cics-sysid': { sev: 'med', evidence: 'path', cwe: 'CWE-15', text: 'Terminal input decides which region a CICS command is shipped to' },
  'cics-web-to-cics-sysid': { sev: 'med', evidence: 'path', cwe: 'CWE-15', text: 'Web input decides which region a CICS command is shipped to' },
  'file-record-to-cics-sysid': { sev: 'low', evidence: 'path', cwe: 'CWE-15', text: 'A file record decides which region a CICS command is shipped to' },
  'database-to-cics-sysid': { sev: 'low', evidence: 'path', cwe: 'CWE-15', text: 'A database value decides which region a CICS command is shipped to' },
  'cics-terminal-to-cics-system-resource': { sev: 'high', evidence: 'path', cwe: 'CWE-15', text: 'Terminal input names the resource an EXEC CICS SET changes' },
  'cics-web-to-cics-system-resource': { sev: 'high', evidence: 'path', cwe: 'CWE-15', text: 'Web input names the resource an EXEC CICS SET changes' },
  'file-record-to-cics-system-resource': { sev: 'med', evidence: 'path', cwe: 'CWE-15', text: 'A file record names the resource an EXEC CICS SET changes' },
  'database-to-cics-system-resource': { sev: 'med', evidence: 'path', cwe: 'CWE-15', text: 'A database value names the resource an EXEC CICS SET changes' },
  // A document from outside parsed as XML. Whether a DTD in it is honoured - an external entity
  // fetched, an internal one expanded - is the parser's, chosen by the XMLPARSE compiler option, and
  // no public repository parses XML from outside, so it is low until graded against the compiler.
  'cics-web-to-xml-document': { sev: 'low', evidence: 'path', cwe: 'CWE-611', text: 'Web input is parsed as an XML document' },
  'cics-terminal-to-xml-document': { sev: 'low', evidence: 'path', cwe: 'CWE-611', text: 'Terminal input is parsed as an XML document' },
  // A response code in a reply tells the client which failure it caused and something of the system
  // behind the program, which is what an attacker probing it wants.
  'system-response-to-web-response': { sev: 'low', evidence: 'path', cwe: 'CWE-209', text: 'A response code or SQL error the system set is sent in a web response' },
  'system-response-to-http-header': { sev: 'low', evidence: 'path', cwe: 'CWE-209', text: 'A response code or SQL error the system set is sent in a response header' },
  // Db2's message text shown on a terminal names the tables, columns and constraints behind the
  // program. A RESP or SQLCODE on an error line is ordinary and is not followed there.
  'system-response-to-screen': { sev: 'low', evidence: 'path', cwe: 'CWE-209', text: 'Db2\'s error message text is shown on the terminal' },
  // A field the program filled and the map protects, read back and used to choose a record: the 3270
  // hidden form field. The terminal enforces PROT and ASKIP, CICS does not (NetSPI 'Conquering CICS',
  // ways 3 and 4). No check lowers it: a key that is well formed is still someone else's key.
  // Medium, because whether a key the list did not offer reaches a record the user could not
  // already choose depends on how the list was scoped, which the code does not say.
  'cics-protected-field-to-record-key': { sev: 'med', evidence: 'path', cwe: 'CWE-639', text: 'A field the map protects, which a modified 3270 client can change, decides which record the program reads or browses from' },
  // Where the record chosen is one the program then rewrites or deletes, the question is no longer
  // what the user may see but what they may change, and an unscoped list is no defence.
  'cics-protected-field-to-record-update': { sev: 'high', evidence: 'path', cwe: 'CWE-639', text: 'A field the map protects, which a modified 3270 client can change, decides which record the program changes or deletes' },
  'cics-web-to-arithmetic': { sev: 'med', evidence: 'path', cwe: 'CWE-1287', text: 'Web input reaches arithmetic on a decimal field, where bytes that are not digits abend the program' },
  'argv-or-env-to-arithmetic': { sev: 'low', evidence: 'path', cwe: 'CWE-1287', text: 'Command-line or environment input reaches arithmetic on a decimal field, where bytes that are not digits abend the program' },
  'jcl-parm-to-arithmetic': { sev: 'low', evidence: 'path', cwe: 'CWE-1287', text: 'A JCL PARM reaches arithmetic on a decimal field, where bytes that are not digits abend the program' },
  'jcl-instream-to-arithmetic': { sev: 'low', evidence: 'path', cwe: 'CWE-1287', text: 'In-stream job data reaches arithmetic on a decimal field, where bytes that are not digits abend the program' },
  // Exfiltration: data at rest leaving through a channel the program opened itself. High for HTTP
  // and sockets, where the far end is named by the program; low for a queue, which is the ordinary
  // way mainframe systems hand data to each other and is listed so the route is visible.
  'database-to-outbound-http': { sev: 'high', evidence: 'path', cwe: 'CWE-201', text: 'A database value is sent to a remote server over HTTP' },
  'file-record-to-outbound-http': { sev: 'high', evidence: 'path', cwe: 'CWE-201', text: 'A file record is sent to a remote server over HTTP' },
  'database-to-socket-send': { sev: 'high', evidence: 'path', cwe: 'CWE-201', text: 'A database value is written to a network socket' },
  'file-record-to-socket-send': { sev: 'high', evidence: 'path', cwe: 'CWE-201', text: 'A file record is written to a network socket' },
  'database-to-message-queue': { sev: 'low', evidence: 'path', cwe: 'CWE-201', text: 'A database value is put on a message queue' },
  'database-to-extrapartition-queue': { sev: 'low', evidence: 'path', cwe: 'CWE-201', text: 'A database value is written to a transient-data queue that leaves the region' },
  'file-record-to-extrapartition-queue': { sev: 'low', evidence: 'path', cwe: 'CWE-201', text: 'A file record is written to a transient-data queue that leaves the region' },
  'file-record-to-message-queue': { sev: 'low', evidence: 'path', cwe: 'CWE-201', text: 'A file record is put on a message queue' },
  // The CALL interface itself, from the same bound pairs the paths above cross. No input has to
  // reach these: a callee that declares more than it is passed reaches past it on every call.
  'call-parameter-exceeds-caller-record': { sev: 'high', evidence: 'construct', cwe: 'CWE-805', text: 'A called program declares a parameter longer than the whole record its caller passes' },
  'call-parameter-exceeds-argument': { sev: 'low', evidence: 'construct', cwe: 'CWE-628', text: 'A called program declares a parameter longer than the field its caller passes, reaching into the fields beside it' },
  // Where the tree holds the estate's entries - a CSD, job steps - a program none of them reaches is
  // one no route in this tree starts. It asserts no defect: it may be started from elsewhere, or be
  // dead, and either is worth knowing before its findings are triaged.
  'program-without-entry': { sev: 'info', evidence: 'context', cwe: null, text: 'Nothing in this tree starts this program: no transaction, job step or program reaches it' },
};

// `impact` names who can do what once a route reaches the sink, so a reader can tell a hole to close
// from one to note; `remedy` is the standard fix, one per sink. Both ride with every finding as
// ruleImpact/ruleRemedy. Composed from the source's actor and the sink's guidance rather than
// written out for each path rule.
export const WHO = {
  'argv-or-env': "Whoever sets the program's command line or environment",
  'cics-terminal': 'A terminal user',
  'cics-web': 'A web caller',
  'file-record': 'Whoever can write the file record',
  'database': 'Whoever can write the database row',
  'jcl-parm': "Whoever can edit the job's PARM",
  'jcl-instream': "Whoever can edit the job's in-stream data",
  // A protected 3270 field is a value a terminal user controls with a modified client.
  'cics-protected-field': 'A terminal user',
};

const SINK = {
  'os-command': {
    clause: "runs an arbitrary operating-system command with the program's authority",
    remedy: "Build the command only from fixed literals; never place input in the argument of CALL 'SYSTEM' or BPXWDYN. If it must vary, choose from an allow-list of known commands",
  },
  'dynamic-sql': {
    clause: 'changes the meaning of the SQL statement',
    remedy: 'Use a static statement with host variables or parameter markers; never concatenate input into EXECUTE IMMEDIATE or PREPARE text',
  },
  'cics-dynamic-transfer': {
    clause: 'chooses which program the region transfers to',
    remedy: 'Resolve the program name from a fixed table of literals, never from input, a record or the communication area',
  },
  'dynamic-program-load': {
    clause: 'chooses which program is called',
    remedy: 'Resolve the called program name from a fixed table of literals, never from input or a record',
  },
  'dynamic-file-path': {
    clause: 'chooses which dataset the program opens',
    remedy: 'Map input to a fixed set of DDs or dataset names; do not build the ASSIGN or dynamic-allocation name from input',
  },
  'internal-reader': {
    clause: "submits an arbitrary job, for a CICS program under the region's authority",
    remedy: 'Build submitted JCL from fixed skeletons; keep input out of the job stream, or validate it against a strict allow-list',
  },
  'web-response': {
    clause: 'places chosen markup or script in the response this program returns',
    remedy: 'Encode input for the output context before WEB SEND or SEND TEXT; do not emit it raw',
  },
  'http-header': {
    clause: 'injects header content, splitting or forging the response header',
    remedy: 'Reject CR and LF and validate the value against an allow-list before WRITE HTTPHEADER',
  },
  'outbound-host': {
    clause: 'sends data at rest to a host the program connects to',
    remedy: 'Confirm the destination and the data classification are intended, and restrict who can write the source record',
  },
  'socket-send': {
    clause: 'sends data at rest over a socket the program opened',
    remedy: 'Confirm the destination and data classification are intended, and restrict who can write the source record',
  },
  'queue-name': {
    clause: 'chooses the queue the message is sent to',
    remedy: 'Select the queue from a fixed table, not from input or a record',
  },
  'message-queue': {
    clause: 'sends data at rest onto a message queue',
    remedy: 'Confirm the queue and data classification are intended; queues are how systems hand data on, so review the destination',
  },
  'extrapartition-queue': {
    clause: 'sends data at rest to an extrapartition queue that leaves the region',
    remedy: "Confirm the queue's destination and the data classification are intended",
  },
  'subscript': {
    clause: 'indexes a table past its bound into adjacent storage, or abends with SSRANGE',
    remedy: 'Bound-check the value against the table size before using it as a subscript, or compile SSRANGE',
  },
  'reference-modification': {
    clause: 'sets a reference-modification start or length past the field into adjacent storage',
    remedy: 'Bound-check the offset and length against the field before the reference modification',
  },
  'occurs-depending-count': {
    clause: 'sets an OCCURS DEPENDING ON count outside its declared range',
    remedy: 'Validate the count against the OCCURS bounds before it sizes the table',
  },
  'loop-bound': {
    clause: 'drives a loop past the table it subscripts',
    remedy: 'Bound the loop counter against the table size, independent of the input',
  },
  'arithmetic': {
    clause: 'puts non-numeric data into a numeric field, abending the transaction (S0C7, ASRA in CICS)',
    remedy: 'Test the field IS NUMERIC before the arithmetic and reject or default on failure',
  },
  'log': {
    clause: 'forges log lines with CR/LF, or writes a credential-shaped value to a log',
    remedy: 'Strip control characters before DISPLAY or journal, and keep credential-shaped fields out of logs',
  },
  'record-key': {
    clause: 'reads a record chosen by a value a modified 3270 client controls',
    remedy: 'Re-derive the key from server state or authorize the access; do not trust a protected or hidden screen field as a key',
  },
  'record-update': {
    clause: 'updates or deletes a record chosen by a value a modified 3270 client controls',
    remedy: 'Re-derive the key from server state and authorize the change; do not trust a protected or hidden screen field as a key',
  },
  'cics-sysid': {
    clause: 'chooses the region a CICS command is shipped to',
    remedy: 'Ship to a region chosen from a fixed table, or name the SYSID as a literal; never take it from input or a record',
  },
  'cics-system-resource': {
    clause: 'chooses the program, transaction, file or queue a system-programming command enables, disables or changes',
    remedy: 'Name the resource an EXEC CICS SET changes from a fixed table, and keep SP commands out of programs input reaches',
  },
  'connection-target': {
    clause: 'chooses the database or queue manager the program connects to, with the program\'s own credentials',
    remedy: 'Connect only to a location or queue manager chosen from a fixed table, never one named by input',
  },
  'xml-document': {
    clause: 'supplies the document XML PARSE reads, where a DTD it carries can name entities for the parser to fetch or expand, if the parser the program is compiled with honours them',
    remedy: 'Refuse a document that carries a DTD (<!DOCTYPE) before XML PARSE, and bound its length; check what the XMLPARSE option the program is compiled with does with entities',
  },
  'storage-length': {
    clause: 'chooses how much storage the program acquires, so a large enough value fails the request or uses up storage it shares',
    remedy: 'Test the length against the most the program means to acquire before GETMAIN or CEEGTST, and refuse anything larger',
  },
};
// Exfiltration over HTTP reads the same as the host case.
SINK['outbound-http'] = SINK['outbound-host'];

// system-response leaks internals rather than carrying input, so both its routes share one line.
const SYSTEM_RESPONSE = {
  impact: 'A system diagnostic (SQLCODE, RESP) reaches the response, revealing internals to the caller',
  remedy: 'Return a fixed message to the caller and keep SQLCODE, RESP and RESP2 out of the response',
};

// The CALL-interface constructs take no input, so they are set outright, not composed.
const CONSTRUCT = {
  'call-parameter-exceeds-caller-record': {
    impact: "The callee's LINKAGE item is longer than the caller's whole argument, so the callee reads past it into unrelated storage on every call",
    remedy: "Make the callee's LINKAGE item no larger than every caller's argument, or pass and honour an explicit length",
  },
  'call-parameter-exceeds-argument': {
    impact: "The callee's LINKAGE item reaches past the argument into the fields beside it on every call, which is sometimes deliberate",
    remedy: "Size the callee's LINKAGE item to the argument, or document that it deliberately spans the following fields",
  },
};

for (const [id, r] of Object.entries(RULES)) {
  if (r.evidence === 'construct') {
    r.impact = CONSTRUCT[id].impact;
    r.remedy = CONSTRUCT[id].remedy;
    continue;
  }
  if (r.evidence !== 'path') continue;   // program-without-entry is context: no impact or remedy
  const at = id.indexOf('-to-');
  const source = id.slice(0, at), sink = id.slice(at + 4);
  if (source === 'system-response') {
    r.impact = SYSTEM_RESPONSE.impact;
    r.remedy = SYSTEM_RESPONSE.remedy;
    continue;
  }
  r.impact = `${WHO[source]} ${SINK[sink].clause}`;
  r.remedy = SINK[sink].remedy;
}

const DEFAULT = { sev: 'med', evidence: 'path', cwe: null, text: 'Untrusted input reaches a sensitive operation' };

// A route on which a check has run before the value is used is lowered one step and says where the
// check is: the check may not turn away everything it should. A route on which what the check leaves
// is safe for the sink - one of a list of literals, digits where digits are needed, a bound where an
// index is - is not a finding at all, and is listed under `checked` with the check that stops it.
const LOWER = { crit: 'high', high: 'med', med: 'low', low: 'info', info: 'info' };
// One graph per repository, for the reason scanAll gives: names are only unique within one.
function analyzeEach(root, opts) {
  if (!opts.repos || opts.repos.length < 2) return analyze(root, opts);
  const merged = { findings: [], constructs: [], unstarted: [], startedBy: {}, stats: {} };
  for (const repo of opts.repos) {
    const one = analyze(root, { ...opts, repos: [repo] });
    merged.findings.push(...one.findings);
    merged.constructs.push(...one.constructs);
    merged.unstarted.push(...one.unstarted);
    for (const [k, v] of Object.entries(one.startedBy)) if (!merged.startedBy[k]) merged.startedBy[k] = v;
    // Counts add; lists join; a count of counts adds field by field; anything else keeps the first.
    for (const [k, v] of Object.entries(one.stats)) {
      const had = merged.stats[k];
      if (typeof v === 'number') merged.stats[k] = (had || 0) + v;
      else if (Array.isArray(v)) merged.stats[k] = [...(had || []), ...v];
      else if (v && typeof v === 'object') { merged.stats[k] = { ...(had || {}) }; for (const [f, n] of Object.entries(v)) merged.stats[k][f] = (merged.stats[k][f] || 0) + n; }
      else if (had == null) merged.stats[k] = v;
    }
  }
  return merged;
}

export function scan(root, opts = {}) {
  const res = analyzeEach(root, opts);
  const findings = [];
  for (const f of res.findings) {
    const meta = RULES[f.rule] || DEFAULT;
    // Compiled with SSRANGE, an index out of range stops the program rather than reaching the
    // storage beside the table: an outage rather than a corruption, one step lower. A sink no route
    // reaches does not run, and the finding asserts no defect.
    const base = f.unreached ? 'info' : f.ssrange ? LOWER[meta.sev] : meta.sev;
    findings.push({
      rule: f.rule,
      sev: base,
      level: f.guard ? (f.guard.stops ? 2 : 1) : 0,
      ...(f.ssrange ? { ssrange: true } : {}),
      ...(f.unreached ? { unreached: true } : {}),
      ...(f.guard ? { guard: f.guard } : {}),
      ...(f.checkElsewhere ? { checkElsewhere: f.checkElsewhere } : {}),
      ...(f.startedBy ? { startedBy: f.startedBy, ...(f.startedByMore ? { startedByMore: f.startedByMore } : {}) } : {}),
      cwe: meta.cwe,
      path: f.sink.file,
      line: f.sink.line,
      program: f.sink.program,
      crossProgram: f.crossProgram,
      hops: f.hops,
      detail: `${meta.text}: ${f.source.detail} at ${f.source.file}:${f.source.line} reaches ${f.sink.detail}` +
        (f.screen && f.source.kind !== 'cics-protected-field' ? `; it starts in ${f.screen.item}, field ${f.screen.field} of map ${f.screen.map}, which the map marks ${f.screen.marks.join(' and ')}${f.screen.declared ? '' : ' by default'}: the terminal enforces that, CICS does not, and a modified client ignores it` : '') +
        (f.unreached ? `; no route from the program's entries reaches ${f.sink.file}:${f.sink.line}, so as the program stands it does not run` : ''),
      ...(f.screen ? { screen: f.screen } : {}),
      // elided and dir are carried through: a reader that has to regex the marker text to learn
      // how many hops are missing cannot tell a truncated trace from one that mentions hops.
      trace: f.path.map(p => ({ program: p.program, item: p.item, file: p.file, via: p.via, ...(p.dir ? { dir: p.dir } : {}), ...(p.elided ? { elided: p.elided } : {}) })),
      related: [{ path: f.source.file, line: f.source.line, detail: f.source.detail }],
      ...(f.also ? { also: f.also } : {}),
    });
  }
  // One sink reached by many sources is one finding, not many: a report where a single statement
  // appears six hundred times says more about the loop than about the program.
  const perSink = new Map();
  for (const f of findings) {
    const key = `${f.rule}|${f.path}:${f.line}|${f.program || ''}`;
    const held = perSink.get(key);
    if (!held) { perSink.set(key, { ...f, sources: 1 }); continue; }
    held.sources++;
    // A sink is credited only as far as the least-credited source that reaches it.
    const level = Math.min(held.level, f.level);
    const also = [...(held.also || []), ...(f.also || [])];
    if (f.hops < held.hops) Object.assign(held, f, { sources: held.sources });
    held.level = level;
    if (also.length) held.also = also;
  }
  // A use one source's route reaches unchecked, and the report leaves out for another use of the same
  // index, still limits how far a finding at that use is credited.
  for (const f of findings) {
    for (const a of f.also || []) {
      const held = a.unreached ? null : perSink.get(`${f.rule}|${a.file}:${a.line}|${a.program || ''}`);
      if (held && a.level < held.level) held.level = a.level;
    }
  }
  for (const held of perSink.values()) {
    if (!held.also) continue;
    const seenAt = new Set();
    const left = held.also.filter((a) => {
      const at = `${a.file}:${a.line}`;
      if (seenAt.has(at) || perSink.has(`${held.rule}|${at}|${a.program || ''}`)) return false;
      seenAt.add(at);
      return true;
    }).sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
    delete held.also;
    if (!left.length) continue;
    const how = (a) => (a.unreached ? 'no route from the entries reaches it' : a.level === 2 ? `stopped by the check at line ${a.guardLine}` : a.level === 1 ? `checked at line ${a.guardLine}, not on every route` : 'not checked');
    held.related = [...held.related, ...left.slice(0, ALSO_LISTED).map((a) => ({ path: a.file, line: a.line, detail: `also ${a.detail}: ${how(a)}` }))];
    held.alsoUses = left.length;
  }
  findings.length = 0;
  const checked = [];
  for (const f of perSink.values()) {
    const { level, ...rest } = f;
    if (level === 2) { checked.push(rest); continue; }
    if (level === 1) {
      const { stops, ...guard } = rest.guard;
      findings.push({ ...rest, sev: LOWER[rest.sev], guard, guardedFrom: rest.sev });
      continue;
    }
    delete rest.guard;
    findings.push(rest);
  }
  // One finding per CALL statement and rule, naming every argument that falls short, so a call
  // with two short arguments is one thing to fix rather than two.
  for (const c of res.constructs) {
    findings.push({
      rule: c.rule,
      path: c.file,
      line: c.line,
      program: c.program,
      ...(c.sev ? { sev: c.sev } : {}),
      detail: `${c.program} calls ${c.callee}: ${c.args.map(a => `argument ${a.position} ${a.argument} is ${a.argumentBytes} bytes (${a.bytesToEndOfRecord} to the end of its record), ${c.callee} declares ${a.parameter} as ${a.parameterBytes}`).join('; ')}${c.sev === 'low' ? `; ${c.callee} only reads past it` : ''}`,
      related: c.args.map(a => ({ path: a.declared.file, line: a.declared.line, detail: `${c.callee} declares ${a.parameter} as ${a.parameterBytes} bytes` })),
      arguments: c.args.map(({ declared, writesPast, ...a }) => a),
      ...(c.startedBy ? { startedBy: c.startedBy, ...(c.startedByMore ? { startedByMore: c.startedByMore } : {}) } : {}),
    });
  }
  for (const u of res.unstarted || []) {
    findings.push({
      rule: 'program-without-entry', path: u.file, line: u.line || 1, program: u.program,
      detail: `nothing in this tree starts ${u.program}: no transaction the CSD defines runs it, no job step runs it, and no program calls, links or transfers to it or spells its name`,
    });
  }
  const { byRule } = finish(RULES, findings, 'flow');
  const entries = res.stats.entryPoints && res.stats.entryPoints.roots ? rollup(findings) : null;
  sortFindings(withMeta(RULES, checked, 'flow'));
  const report = {
    // Its own name: a flow report dropped where a scan report is expected has three rule sets
    // missing, and with the scan's name it read as a whole one.
    tool: 'cobolwork-flow',
    schemaVersion: SCHEMA_VERSION,
    summary: {
      findings: findings.length,
      byRule,
      flowModel: FLOW_MODEL,
      toolVersion: TOOL_VERSION,
      filesScanned: res.stats.files,
      programsParsed: res.stats.programs,
      filesUnreadable: res.stats.threw + (res.stats.unreadable || 0),
      filesEbcdic: res.stats.ebcdic || 0,
      filesOverBudget: res.stats.overBudget,
      crossProgram: findings.filter(f => f.crossProgram).length,
      // Routes a check stops, listed under `checked` rather than counted.
      checked: checked.length,
      ...(res.stats.entryPoints ? { entryPoints: res.stats.entryPoints } : {}),
      ...(entries ? entries : {}),
      ...(res.stats.programsUnordered ? { programsUnordered: res.stats.programsUnordered } : {}),
      // What a RECEIVE MAP could be read against. A map whose source is not here leaves which of its
      // fields are protected unknown, which is a limit on the protected-field rule, not a result.
      ...(res.stats.mapsReceived ? { mapsReceived: res.stats.mapsReceived, protectedFields: res.stats.protectedFields,
        ...(res.stats.mapsNoSource || res.stats.mapsNoSymbolic ? { mapsNotRead: `${res.stats.mapsNoSource + res.stats.mapsNoSymbolic} of ${res.stats.mapsReceived} RECEIVE MAP statement(s) could not be read against their map: ${res.stats.mapsNoSource} name a map whose BMS source is not in the tree, ${res.stats.mapsNoSymbolic} have no symbolic map the program declares, so which fields they protect is not known` } : {}) } : {}),
      nosrc: res.stats.files === 0,
      // This set states its own coverage now. It did not, and the conformance test over the
      // registry is what noticed: it is the largest set, it has both a byte budget and the memory
      // guard, and it was the one set that never said whether it had read everything. scanAll
      // happened to compute the right answer for the whole report - it ORs filesOverBudget in
      // separately - so nothing was wrong downstream, and nothing would have been until someone
      // called this set on its own and believed a silence.
      coverageIncomplete: (res.stats.overBudget || 0) > 0
        || (res.stats.filesNotReached || 0) > 0
        || (res.stats.unreadable || 0) > 0
        || (res.stats.threw || 0) > 0
        || (res.stats.walksCut || 0) > 0
        || (res.stats.sourcesNotWalked || 0) > 0,
      // A walk stopped at its bound, or a source never walked, may leave a path unfound.
      ...(res.stats.walksCut || res.stats.sourcesNotWalked ? {
        walksCut: res.stats.walksCut, sourcesNotWalked: res.stats.sourcesNotWalked,
        readInPart: `${res.stats.walksCut} source(s) stopped at the bound on one walk and ${res.stats.sourcesNotWalked} not walked once the analysis reached its own; paths from them may be missing`,
      } : {}),
      // A check whose route could not be followed to the end credits nothing, so these are reported unchecked.
      ...(res.stats.creditUndecided ? { creditUndecided: res.stats.creditUndecided } : {}),
      // The internal-reader rules could not run over queues nobody declared. That is configuration
      // rather than coverage - every file was read - and it travels the way recon's does.
      ...(res.stats.tdWritesUndecided ? {
        setIncomplete: true,
        notLooked: [`${res.stats.tdWritesUndecided} EXEC CICS WRITEQ TD statement(s) write to an extrapartition queue, and nothing says whether it reaches the internal reader: name the region's INTRDR DDs as internalReaderDds (or the queues as internalReaderQueues) in cobolwork.site.json`],
      } : {}),
      ...(res.stats.unreadableFiles ? { unreadable: res.stats.unreadableFiles } : {}),
      ...(res.stats.unparsedFiles ? { unparsed: res.stats.unparsedFiles } : {}),
      ...(res.stats.filesNotReached ? { filesNotReached: res.stats.filesNotReached } : {}),
      ...(res.stats.stoppedBy ? { stoppedBy: res.stats.stoppedBy } : {}),
    },
    findings,
    checked,
    ruleText: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.text])),
    ruleCwe: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.cwe]).filter(([, v]) => v)),
    ruleImpact: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.impact]).filter(([, v]) => v)),
    ruleRemedy: Object.fromEntries(Object.entries(RULES).map(([k, v]) => [k, v.remedy]).filter(([, v]) => v)),
  };
  // What starts each program, for the whole scan to put on findings no other set could place. Not
  // printed: it is the same fact every finding already carries.
  Object.defineProperty(report, 'startedBy', { value: res.startedBy || {}, enumerable: false });
  // Every sink and source the graph holds, reached or not, when asked for: never printed.
  if (res.sinks || res.sources) Object.defineProperty(report, 'listed', { value: { sinks: res.sinks || [], sources: res.sources || [] }, enumerable: false });
  return report;
}

// Findings counted by the transaction or job that reaches them: the unit a mainframe team triages
// in. A finding several entries reach counts under each.
export function rollup(findings) {
  const byTransaction = {};
  const byJob = {};
  for (const f of findings) {
    for (const e of f.startedBy || []) {
      if (e.transaction) byTransaction[e.transaction] = (byTransaction[e.transaction] || 0) + 1;
      if (e.job !== undefined) { const k = `${e.job || '?'} ${e.step || '(unnamed)'}`; byJob[k] = (byJob[k] || 0) + 1; }
    }
  }
  return { byTransaction, byJob };
}
