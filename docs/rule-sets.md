# What cobolwork finds, and what it leaves out

The [README](../README.md) gives each area a line. This is each one in full: what its rules report,
what they deliberately do not, and what a report says when a rule could not run. Every rule's id,
severity, CWE and evidence kind — and, for a defect rule, what it lets someone do and the standard
fix — is in its set's table under [`lib/sets/`](../lib/sets/), and every scan report carries them.

## Data flow

**Data flow, across programs and in from the job.** From `PARM=` on a JCL `EXEC` and in-stream data
on a `DD`, through `ACCEPT FROM COMMAND-LINE`, `EXEC CICS RECEIVE`, `EXEC CICS WEB RECEIVE`, file
reads and SQL host variables, through `MOVE`, `STRING`, `COMPUTE` and the rest, across `CALL ...
USING` arguments and the CICS communication area, into `CALL 'SYSTEM'`, `EXEC SQL EXECUTE
IMMEDIATE`, `EXEC CICS LINK` and `XCTL` with a variable program name, a dynamic `CALL`, and `ASSIGN
TO` a variable. Taint is tracked by byte range, so a value reaching one field of a group follows its
own bytes through a group `MOVE`, a `REDEFINES` overlay and a `CALL ... USING` argument, while the
fields it does not overlap stay clean. A trace longer than 64 hops keeps its first and last 24 and
says how many it left out; `--full-trace` lists every hop instead, at a cost that grows with the
square of the chain length.

**Checks on the path, in the order they run.** Each program's procedure division is read as a
control-flow graph - `IF`, `EVALUATE`, `SEARCH`, `PERFORM` of a paragraph or a `THRU` range, inline
`PERFORM`, `GO TO`, `NEXT SENTENCE`, the `AT END` and `INVALID KEY` phrases, and `STOP RUN`,
`GOBACK` and `EXEC CICS RETURN`. A check counts only where it has run, on every route, since the
field was last written, and before the value is used. A check that restricts a field - a class test
such as `IS NOT NUMERIC`, a bound, a condition-name - and has run first lowers the finding one step
and names itself; on a subscript, reference modification, `OCCURS DEPENDING ON` count or loop bound
it lowers only where one outcome of the check holds on every route to the use, since a route on which
the check failed and the program carried on reaches the index out of range. Where what the check
leaves is safe for the sink, the route is not a finding at
all: a value that can only be one of a list of literals, digits where a command, a statement or a
job is built, a bound at both ends where a subscript or reference modification indexes a table
(at least 1 and at most the table's size). Such routes are listed under `checked`, with the
check that stops them. A buffer tested for one prompt and used for another, or tested in a paragraph
performed after the use, keeps its full severity and says where the check it did not get is
(`checkElsewhere`). Equality counts only where it pins the value: inside `IF X = 'A'`, or after an
`EVALUATE` whose `WHEN OTHER` ends the run or leaves; `IF X = SPACES` before a use, and an
`EVALUATE` that only chooses what else to do, check nothing. A check that only sets a flag has run,
but the flag's later test is not read as stopping the value, so it lowers and does not clear (on an
index sink, only where the flag decides the route to the use). A sink
that another route reaches without the check keeps its full severity.

**What starts each program.** A finding carries `startedBy`: the CICS transactions the CSD defines
for its program (from a CSD extract or `DFHCSDUP` input), the alias transaction a server `URIMAP`
serves it under (`CWBA` unless the map names one, with the map and its path), the job steps that run it (`EXEC PGM=`,
and TSO `CALL` and DSN `RUN PROGRAM` under a TSO batch step, each handed the step's DDs, its
ALLOCATE commands included, and its parameter string as PARM), and whatever those reach by `CALL`, `LINK`, `XCTL`, or
`START` and `RETURN TRANSID`. `summary.byTransaction` and `summary.byJob` count findings by the
entry that reaches them, which is how a mainframe team triages. Where the tree holds any of those
entries, a program none of them reaches is reported as context (`program-without-entry`), unless
another program spells its name in a literal - a menu that transfers through a table of names - or
any program went unread, since the missing caller may be among them.

**The job is the entry point.** A JCL step chooses the program, hands it a `PARM` and fills the DD
names it reads, and all of that is written in files anyone who can commit can edit. `PARM=` is
followed into the program's first `PROCEDURE DIVISION USING` item, and in-stream data on a DD is
followed into whatever record the program reads from that DD — a join neither file states, since the
COBOL says `ASSIGN TO SYSIN` and the job says `//SYSIN DD *`.

**Where a statement reads and writes.** A subscript, the start or length of a reference
modification, or the count an `OCCURS DEPENDING ON` table is sized by, taken from the command line,
a terminal, the web or a job. Without `SSRANGE`, which is not the Enterprise COBOL default, an index
out of range reads or writes the storage beside the table; with it, set on a `CBL` or `PROCESS`
card, the program abends, and the finding says so and is one step lower. A test of the index that
leaves some value out of range (`IF WS-IDX > 10` leaves 0) lowers it where the program acts on the
test, and not where it carries on past a failed one; a bound at both ends stops the route. An index counts from 1: entry 0 is the storage before the table, and a
reference-modification length of 0 is a zero-length move that can overrun. File records and database values are not followed into
these: in batch COBOL nearly every subscript descends from one.

**The internal reader.** Input written where the internal reader will submit it as a job: through a
DD its job sends to `SYSOUT=(class,INTRDR)`, or by `EXEC CICS WRITEQ TD` to a queue the CSD maps to
a DD that `cobolwork.site.json` names in `internalReaderDds`. The CSD is read from `.csd` extracts
and from `DFHCSDUP` job input. The region's own JCL, which is what makes a DD the internal reader,
is rarely in an application repository, so without the declaration the rule has not run and the
report says so under `setsIncomplete` rather than reading clean.

**Exfiltration paths.** Data at rest (a database row or a file record) reaching a channel the
program opened itself: `EXEC CICS WEB CONVERSE`, or `WEB SEND` on a client session; a socket `SEND`
through `EZASOKET`; `MQPUT`. A web program answering its own caller is not a finding. Queue routes
are low severity, listed so the route is visible, because queues are how mainframe systems
ordinarily hand data to each other.

**Screen fields a modified terminal can change.** A map's `PROT`, `ASKIP`, `DRK` and `NUM` are
enforced by the 3270 emulator, not by CICS, so a modified client writes a protected field and reads
a dark one, as a browser does a hidden form field. Each `RECEIVE MAP` is read against its map - a
map named through a constant included - and a field the map protects that the program put there,
reads back and uses as the key of a `READ` or browse is `cics-protected-field-to-record-key`,
however many programs the key passes through first. Where the key chooses a record the program then
rewrites or deletes - a `READ UPDATE` of a file it later rewrites or deletes, whose `REWRITE` or
`DELETE` carries no key of its own, or a `DELETE` by key - it is
`cics-protected-field-to-record-update`, at high rather than medium. CardDemo has one of the first
and two of the second: each list screen's row ID, read back from its protected field and carried
through the communication area to the program that views a transaction, or updates or deletes a user
in the user security file. A key the user types is how a lookup works and is not reported, and no
check lowers either finding, since a well-formed key is still someone else's. Terminal findings that
start in a restricted field say so. A `RECEIVE MAP` whose map source is not in the tree is counted
in `mapsNotRead` rather than read as clean. The same work taught the flow engine that `XCTL
PROGRAM(name)` reaches the program the name holds at that point, which is how CardDemo names every
transfer.

**What reaches a log, and what reaches a web client.** Terminal or web input written unchecked to a
log is `cics-terminal-to-log` or `cics-web-to-log` (CWE-117, low). A log is a `DISPLAY`, a journal,
the operator console, or a transient data queue that neither starts a transaction nor feeds the
internal reader. A log is read as lines, and a modified client can put a line break in a field; a
check that leaves the field letters or digits stops the route. A batch job logging its own `PARM` is
not reported, since whoever submits the job writes that log already. Over the corpus the rule found
IBM GenApp's `LGSTSQ`, which writes whatever a terminal sends to the CSMT message log. A response
code or SQL error the system set - a command's `RESP`, `EIBRESP`, `SQLCODE` - sent in a web response
or header is `system-response-to-web-response` or `system-response-to-http-header` (CWE-209, low),
and no check lowers it. Nothing in the public corpus uses the CICS web API, so those two ship with
benchmark cases and no measured rate. Db2's message text, `SQLERRMC`, shown on a terminal by `SEND
TEXT` or `SEND MAP` is `system-response-to-screen` (low): it names the tables, columns and
constraints behind the program, where a `RESP` on an error line is ordinary and is not followed there.

**What a caller chooses beyond the data.** Input that sets how much storage a program acquires - the
`FLENGTH` or `LENGTH` of `EXEC CICS GETMAIN`, the size `CALL 'CEEGTST'` is given - is
`*-to-storage-length` (CWE-770): medium in a CICS region, whose storage every task shares, low from a
job's own `PARM` or command line; an upper bound tested first clears it. Input naming the Db2 location
of `EXEC SQL CONNECT TO` or `SET CONNECTION`, or the queue manager `MQCONN` or `MQCONNX` is given
first, is `*-to-connection-target` (CWE-99). Input naming the `SYSID` a CICS command is shipped to is
`*-to-cics-sysid` (CWE-15, medium: the other region applies its own link security); input naming
the resource an `EXEC CICS SET` changes is `*-to-cics-system-resource` (high, and privilege
escalation, since that is a system-programming command). An allow-list of literals clears either.
Web or terminal input parsed by `XML PARSE` is `*-to-xml-document` (CWE-611, low): whether a DTD in
the document is honoured is the `XMLPARSE` compiler option's, which is not read, and no public
repository parses XML from outside. These are the z/OS-derived designs N-RECVLIMIT, N-CONNSTR,
N8 and N-XXE of `docs/spec/z-sibling-rules.md`; `GETMAIN` with a field is in two public repositories,
`MQCONN` in two and `CONNECT TO` with a host variable in none, so all of them ship with fixtures and
no measured rate.

## CICS and CALL interfaces

**CICS checks.** A program that reads its communication area without ever checking `EIBCALEN`; a
transfer to a program named by a variable; a `LENGTH` longer than the area passed or than the
callee's own declaration. The last two need exact field sizes, which is what the parser is graded
on. A sign-on a program performs itself, bypassed: where a password comparison succeeds the program
transfers somewhere, and a route to that same program that does not pass the comparison - a PF key
the sign-on screen does not expect, a missing communication area - is a way in without a password.
Which comparison is the sign-on is read from field names (`PWD`, `PSWD`, `PASSW`), and a sign-on
that only sets a flag for a later test is not followed. The same comparison, where one side is read
back from the program's own file record, `EXEC CICS READ INTO` area or `SELECT` host variable, is
`program-checks-stored-password` (CWE-256, medium): the password is stored where the application
can read it, rather than checked by `EXEC CICS VERIFY PASSWORD` or `SIGNON`. A copy made by `MOVE`
before the comparison is not followed. A password field folded to one case by `FUNCTION UPPER-CASE`
or `LOWER-CASE`, or by `INSPECT CONVERTING`, in a program that compares passwords is
`password-case-folded-before-compare` (CWE-178, low). CardDemo's `COSGN00C` does both.

**Failures nobody looks at.** `NOHANDLE` with no `RESP` and no `EIBRESP` test before the next
command, and `IGNORE CONDITION`, are `cics-condition-ignored` (CWE-252, low): one finding per
program, at the first, with the count. Deleting a temporary-storage queue, a line written to a
transient-data log, the clock, a `SEND` to a terminal, `ASSIGN` and `RETURN` are the ordinary uses
of `NOHANDLE` and are not counted.

**Cross-site request forgery.** A program that receives a web request and changes state - `EXEC
CICS WRITE`, `REWRITE` or `DELETE` on a file, `EXEC SQL UPDATE`, `INSERT`, `DELETE` or `MERGE`, or
`EXEC CICS START` of a transaction - with no condition comparing a token-named field with another
field is `web-request-changes-state-without-a-token` (CWE-352, medium). A token tested only against
`SPACES` verifies nothing, and a test of the HTTP method, which a forged request sets too, is named
in the finding. A temporary-storage queue is where a web program keeps its own conversation and is
not counted as a change.

**CICS as an HTTP client.** `WEB OPEN` that asks for HTTP rather than HTTPS - the `HTTP` option,
`SCHEME(HTTP)`, or a client `URIMAP` the tree's CSD defines with `SCHEME(HTTP)` and no
`ATTLS(AWARE)` - is `web-client-opens-cleartext` (CWE-319, medium): what the program sends and reads
crosses the network in the clear unless an AT-TLS policy outside the program encrypts it. A scheme
held in a field, or a `URIMAP` the tree does not define, is counted as undecided. A `WEB RECEIVE`
or `WEB CONVERSE` whose `MAXLENGTH` is longer than its `INTO` area is
`web-receive-length-exceeds-area` (CWE-805, high): CICS copies up to `MAXLENGTH` bytes of a body the
other end chooses into the area. `MAXLENGTH` is judged as a literal or `LENGTH OF` an item, since a
field's value can change before the command. With `INTO`, CICS refuses a receive that gives no
`MAXLENGTH` (`INVREQ`, RESP2 16), so an absent one is not an overflow.

**What a program asks ICSF for.** A COBOL program reaches z/OS cryptography by calling an ICSF
callable service, and the strength it gets is in the arguments. `rules/icsf-services.json` holds
each service's parameters in order, from IBM's ICSF Application Programmer's Guide (SC14-7508-60),
and each argument is judged by the literals that can reach it: its `VALUE`, a `MOVE` or `STRING`
into it, a hop back through a field those name. A key generated as `SINGLE`, `KEYLN8` or `SINGLE-R`
(`CSNBKGN`) is `icsf-single-length-des-key` (CWE-327, high): 56 bits, and every encipher with it
runs single DES. A rule array naming `MD5` or `SHA-1` for `CSNBOWH` is `icsf-weak-hash` (CWE-328,
medium). An initialization vector nothing but a constant is ever put in, for `CSNBENC`, `CSNBSYE`
or `CSNBSAE`, is `icsf-fixed-initialization-vector` (CWE-1204, medium); `ECB` and `CONTINUE`, which
use no vector of the call's, are not judged. Every name a service answers to counts (`CSNB`, `CSNE`,
`CSF` and the data-space forms). An argument a computation, a read or another program fills is
counted as undecided, not passed.

**CALL interfaces.** The same size check for `CALL ... USING`: a called program that declares a
parameter longer than its caller's argument reaches past it on every call. Past the caller's whole
record is high; inside it, into the fields beside the argument, is low, because that is sometimes
deliberate. A parameter holding an `OCCURS DEPENDING ON` table is not compared, since its declared
size is its largest.

## Privilege and logs

**Privilege.** What a transaction or a job may do that nothing in the repository says it needs. A
definition in the repository that installs one of the CICS diagnostic transactions - `CECI`, `CEMT`,
`CEDA`, `CEDF`, `CESF`, `CECS`, `CEBR` - is high. A transaction defined without command security is
medium, but only where its program issues the system commands command security governs: CICS'
defaults are permissive, so `CMDSEC(NO)` on its own is every transaction definition in the corpus
and means nothing, and the finding is the use the definition did not refuse. Three more are
`context` until the estate states the fact that makes them a defect, because the fact lives in the
running system rather than any repository: a job naming the user it runs as (`surrogateUsers` in
`cobolwork.site.json`), a job unloading the security database (`restrictedDatasets`), and a job
loading from a library the estate calls authorised (`apfLibraries`).

**What a field's name says it holds, written to a log.** A `DISPLAY`, `WRITEQ TD`, `WRITE
JOURNALNAME` or `WRITE OPERATOR` of a field named as a credential is high, and of one named as
personal data is medium (CWE-532), wherever it runs. The rule is its matcher: a name counts only by
whole hyphen-delimited components, so `COMPANY-NAME` does not hold a `PAN`, some components count
only in pairs (`CARD` with `NUM`), and `ACCT-NO` is left out, because in COBOL it is almost always a
general-ledger account - over the corpus it was 83 of 90 personal-data hits, all of them in one
payroll program. Measured over 22,800 `DISPLAY` statements, 11 were real.

A credential name also has to fit the field. A name that is about a credential
(`WS-PASSWORD-PROMPT`, `WS-TOKEN-COUNT`, `WS-PASSWORD-VALID`) is not one, and a field declared
numeric holds a number unless it is a `PIN` of four digits or more. `TOKEN` is a lexer's word as
often as a credential, so it counts only beside a word such as `AUTH`, `ACCESS`, `BEARER`, `API` or
`SESSION`, or where the value came from something that only yields credentials: an environment
variable, a masked or credential-prompted terminal entry, a CICS `VERIFY` or `SIGNON`, or a file
named for secrets.

Two plain `DISPLAY`s of a credential are not log writes, and are reported low as
`display-echoes-a-credential` (CWE-200), in no class a build refuses. One shows the person at the
terminal what they typed at a prompt, in a program no job in the repository runs or compiles; if a
job does, or one runs a program nothing names, its `ACCEPT` reads `SYSIN`, its `DISPLAY` goes to
`SYSOUT`, and the write stays high. The other is a CGI program, one that writes a `Content-Type`
header, putting what the request posted into its response, traced back through the moves that fill
it to standard input, a request variable, or a routine the program names the request to. A session
token issued in a `Set-Cookie` header is not reported. A password read from a file and displayed
stays high, prompt or no prompt, in a CGI response or not, and so does anything sent `UPON CONSOLE`
or `UPON SYSERR`.

## JCL and the estate

**JCL as an attack surface.** Statements folded across continuations, in-stream data bounded by its
own delimiter, symbolic parameters substituted, and every step tied to the program it runs. A
password or a RACF command in a `SYSIN DD *`; a dataset deleted in-stream; a `DLM=` that carries the
stream past the `/*` a line-by-line reader stops at; a step running a program that is neither a
system utility nor defined anywhere in the tree. An FTP step with no TLS option on its `PARM` or in
an in-stream `SYSFTPD` is a cleartext session, a password its input logs on with is a credential,
and a `PUT`, `MPUT` or `APPEND` of a dataset the site calls production is that data leaving the
system; without production qualifiers the last has not run, and the report says so. `PARM=` on a
step that runs a program in the tree is also listed as an entry point
(`jcl-parm-is-an-entry-point`), the inventory of where untrusted data enters.

**Reconnaissance leakage.** Names this estate calls production, appearing in jobs it does not call
production, and routable addresses written into source. Where a DD in such a job names a production
dataset, the finding says what the step's disposition does to it: creating, extending, holding
exclusively or deleting it is high, reading it is medium, and the statement is reported once rather
than again as a name. What counts as production is a fact about the customer, so the shape ships
here and the facts live in `cobolwork.site.json`; `node diag/propose-site.mjs <path>` drafts one
from the estate's own JCL for a person to correct. Without that file the rules have not run, and the
report says so as `setsIncomplete` rather than reporting a clean result.

## The build

**What the build pins.** Every published advisory against GnuCOBOL describes a crafted source file
compiled by `cobc`, which is exactly what CI does to a pull request. The build files are read for a
pinned compiler version and compared against `rules/advisories.json`, every row of which was
retrieved from NVD and is re-resolved by `diag/refresh-advisories.mjs`. A version named in CISA's
Known Exploited Vulnerabilities catalogue is reported critical rather than high.

IBM publishes much of what it knows about IBM Z only on its Security Portal, to customers who
register, and not for redistribution. An estate with that access brings its own extract to a scan:
`--advisories <file>[,<file>]` (or `COBOLWORK_ADVISORIES`, or `advisoryFeeds` from code) names a
JSON file of `{ extract, retrieved, coverage, advisories }`, whose rows are held to the same shape
as the published ones. A feed kept inside the tree being scanned is refused, since everyone who can
read the repository could read it. The summary's `advisoryFeeds` names every feed a scan used, and a
finding says which advisories came from one. A feed that was asked for and not loaded, or a row the
gate refused, makes the set incomplete.

**Vendor rule packs.** Commands belonging to a product rather than to the platform, loaded only by
the estates that name the pack, so a shop that does not run it sees no rules for it. Three ship:
Broadcom (CA ACF2 and Top Secret), BMC Control-M, and IBM Connect:Direct. A rule matches either the
program a step runs or a line of in-stream data, and a pack also declares the programs its product
supplies, which makes the unresolved-program rule quiet about `DMBATCH` and `CTMAPI` for exactly the
estates that said they run them.

A pack records two kinds of validation and will not load with neither: a **corpus measurement**,
which says how often its rules fire and therefore how noisy they are, and a **practitioner review**,
which says whether its risk statements are true. Neither implies the other — a thousand repositories
will report a wrong rationale quietly and wrongly all day — so whichever is missing is named on
every scan that uses the pack. Measure one with `node diag/measure-rules.mjs <corpus> --packs
<name>`.

## The source itself

**Programs that cannot compile.** A program that uses a name nothing declares - not the program, not
a copybook it includes, not the compiler, the CICS or IMS translator or the Db2 precompiler - is
reported once, with each name and where it is used. Enterprise COBOL stops such a program with
`IGYPS2121-S`, so the source in the tree is not the source of anything that runs; it is also what
generated modernisation code looks like when nobody compiled it. What the compiler supplies is IBM's
reserved-word table and GnuCOBOL's dialect lists, cited in `lib/words.mjs`. A name is called
undefined only when every copybook the program includes was found and the parse read all of it;
otherwise the program is counted as undecided, with the reason, and the set reports its coverage as
incomplete.

**What the generated code decides.** Three rules read the options a program is compiled with - its
`CBL` and `PROCESS` cards, the JCL step that compiles it, and `compilerOptions` in
`cobolwork.site.json` - and report what the source does not say. Under `TRUNC(OPT)`, a `COMP` or
`BINARY` receiver given a value with more integer digits than its `PICTURE`, by a `MOVE` from a wider
field or an operand or product wider than it (an increment is not counted, and `ON SIZE ERROR` is the
program saying what happens): the field then holds what the generated code happens to keep. A
`COMPUTE` whose fixed-point intermediate is wider than `ARITH` lets the compiler carry, 30 digits or
31 under `ARITH(EXTEND)`, so high-order integer digits can be dropped without `SIZE ERROR`;
exponentiation and functions are counted as unread. And a `THRU` range of characters, in an 88-level
`VALUE` or a `WHEN`, that is in order in EBCDIC and reversed in ASCII or the other way round, so it
is empty on one of them. The first two follow ironwork's model of the compiler, assumptions C2 and
C1 in its register, which no Enterprise COBOL compile has settled yet, and every finding says so. A
program with no `TRUNC(OPT)` anywhere is not judged by the first, and one that declares its own
`PROGRAM COLLATING SEQUENCE` is not judged by the third.

**Copybook shadowing.** Two copybooks answering to one name with different layouts, with the
programs that resolve each; a repository copy of a system copybook (`SQLCA`, `DFHAID`, …), which the
search path finds before the system's own.

**Hidden content, aimed at the agents now reading this code.** Payloads in the columns a compiler
ignores, comments that instruct their reader to ignore instructions or fetch a script, long encoded
runs, and characters that reorder or hide text.

**Mainframe credentials.** `rules/gitleaks-mainframe.toml` extends gitleaks with the shapes it has
no rules for: a RACF password or password phrase on a JCL statement, plain, in apostrophes, or
continued past column 71 onto the next statement, a TSO logon, `ADDUSER`, `ALTUSER` and the RACF
`PASSWORD` and `PHRASE` commands, a credential in a COBOL `VALUE` clause, including hexadecimal,
national, DBCS, null-terminated and UTF-8 literals, one continued onto the next line, and one on a
debugging line, `EXEC SQL CONNECT`, and `EXEC CICS SIGNON`, `VERIFY` and `CHANGE`. A continued value
is reported by its first part. Where a statement changes a password, the new one is a finding of its
own. Each form is one IBM's manuals define: the z/OS JCL Reference, the RACF Command
Language Reference, the TSO/E Command Reference, CICS TS 6.x and the Enterprise COBOL Language
Reference. CICS's `PHRASE` and `NEWPHRASE` take a data area, which cannot be a literal.

gitleaks detect --no-git --source . --config "$(cobolwork --rules-path gitleaks)"

gitleaks reads a file in pieces of about 100 KB, ending each at a blank line within the next 25 KB
if it finds one. Fixed-format COBOL seldom has blank lines, so in a large program a `VALUE` on the
line after its data name can fall into the next piece and go unreported. The `secrets` set reads
each file whole.

The `secrets` set reports the COBOL shapes without gitleaks, reading them from the same file: a
literal `VALUE` on an item named for a credential, a literal password in `EXEC SQL CONNECT`, and one
in the `PASSWORD` or `NEWPASSWORD` of `EXEC CICS SIGNON`, `VERIFY` or `CHANGE`. Each is
`credential-in-source` (CWE-798, high), naming the item or statement and the shape, never the value. A program or copybook the tree
classifies is read whatever its name, where gitleaks reads only the extensions the file lists.
The rule's firing rate over the corpus is not yet recorded, so the build gate treats it as a warning
unless the policy's `rules` names it `block` (build-gate.md §11d).

## Assembler

**What a stub does that COBOL cannot.** HLASM source (`.asm`, `.mac`, `.mlc`, `.hlasm`,
`.assemble`, or no extension and a section or macro definition with storage) is read as cards by
`lib/hlasm.mjs`, and each operation is looked up in `rules/hlasm-operations.json`, which cites the
IBM manual defining it. A `MODESET` that switches to key zero or supervisor state
(`KEY=ZERO`, `MODE=SUP` or `EXTKEY=ZERO`) is critical; one that returns to the caller's key
and problem state is not reported. `EX` and `EXRL` run their target with its second byte from a
register, which for a move is its length, and the cross-memory instructions (`PC`, `PR`, `PT`,
`SSAR`, `LASP`) reach another address space; both are high. `RACROUTE`, `RACHECK` and `RACINIT`
called directly are listed as context. `LINK`, `XCTL`, `LOAD` or `ATTACH` given `EPLOC=` or `DE=`
names its module by the address of the name, so the program that runs is whatever that storage
holds; that is medium (CWE-470), and `EP=` with a written name is not reported. An `EX` finding
names the instruction it runs when the target is labelled in the same file. A BMS map or an IMS DBD or PSB in a `.asm` file is counted
as what it is, and a file with no HLASM operation the reader recognises (x86, 6502 or a copy member
of `EQU`s) is counted as unrecognised.

**The module a CALL reaches.** A COBOL `CALL 'NAME'` that no COBOL program declares may be an
assembler module. A `CSECT` or `ENTRY` of that name is reported as the module the call reaches, and
the JCL rules count it as a defined program, so a step that runs it is not unresolved.

It reads; it does not assemble. Macros are not expanded and conditional assembly is not evaluated,
so an operation a site macro issues is seen in the macro's definition, not where the macro is used,
and an operation in a branch `AIF` jumps over is reported as much as any other. The scan names the
macros it did not expand, each COPY member the tree does not hold and each statement the statement
reader (`lib/hlasm/read.mjs`) refused, by kind; the last two set `coverageIncomplete`.

## Change review

**Change review.** `cobolwork diff` compares two revisions the way the compiler sees them. A
one-line copybook edit changes the record layout of every program that COPYs it without touching any
of their source, so the review lists each program whose fields moved, says which of them the change
never edited, and rates a moved record that crosses a program boundary (linkage, a CICS
communication area, a CALL argument) highest.

## What it reads

Programs (`.cbl`, `.cob`, `.cobol`, `.sqb`, `.pco`), copybooks (`.cpy`, `.copy`, `.inc`) and JCL
(`.jcl`, `.job`, `.proc`, `.prc`, `.cntl`), one definition shared by every rule set. EBCDIC members
are recognised and decoded, including fixed 80-byte records with no line ends. Symlinks are followed
while they stay inside the tree. A `COPY` that names a file outside the tree is refused and
reported; `COBCPY` and `COBOLWORK_COPYPATH` name libraries outside it that may be read.

BMS maps (`.bms`, or no extension and a `DFHMSD` macro) are read by `lib/bms.mjs`. Each field gives
its position, length, pictures, initial value, `OCCURS` and `GRPNAME`, and its `ATTRB` twice: as
declared, and as BMS applies it, which is `(ASKIP,NORM)` when the map gives none and unprotected,
unless it says otherwise, when it gives any. A named field is tied to the names a program uses for
it (`PASSWDI`, `PASSWDL`, `PASSWDA` and the rest, in `COSGN0AI` and `COSGN0AO`) and back; a field
with no name is a constant on the screen and has none. There is no compiler to grade this against,
since no free assembler ships the `DFH` macros; the generated names were checked instead against
every copybook CICS generated in the corpus that has its map beside it, 5,265 names in CardDemo's 21
maps, all matching.

What it could not read is part of every report: unresolved and refused copybooks, unreadable files
and directories, symlinks leading out of the tree. Any of them sets `coverageIncomplete`, because a
finding count over fields nobody read is not a clean result. Every report carries `schemaVersion`
and `toolVersion`, and every report of a command that follows data flow also carries `flowModel`
(currently `byte-range`), so a stored result says what produced it.

## Compliance

What the mapping in `rules/compliance-*.json` does not claim travels with it. The clause choice is a
judgement and no qualified assessor has reviewed it. DORA's Chapters III to V place obligations no
static analysis can evidence, and seven of the FFIEC handbook's ten booklets do the same. Neither
NIST nor FFIEC has a control that genuinely covers committing an LPAR name to a repository, so the
two reconnaissance rules are recorded as unmapped with a reason in both, rather than mapped to the
nearest control that reads plausibly.

FFIEC clause identifiers name their booklet - `DA&M V.C`, `IS II.C.19`, `AIO VI.C.3` - because
section numbers repeat across booklets and mean different things in each. `DA&M V.C` names static
analysis as a control and describes what it does, so it is claimed once for the tool rather than per
rule.

All three ship with quotes because their instruments may be reproduced: one is EU law, two are US
Government works. COBIT 2019 ships as identifiers with this project's rationale and no ISACA text,
each practice following the rule's NIST control through a crosswalk. PCI DSS may not be
redistributed and is not mapped.
