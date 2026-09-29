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
and names itself. Where what the check leaves is safe for the sink, the route is not a finding at
all: a value that can only be one of a list of literals, digits where a command, a statement or a
job is built, a bound where a table is indexed. Such routes are listed under `checked`, with the
check that stops them. A buffer tested for one prompt and used for another, or tested in a paragraph
performed after the use, keeps its full severity and says where the check it did not get is
(`checkElsewhere`). Equality counts only where it pins the value: inside `IF X = 'A'`, or after an
`EVALUATE` whose `WHEN OTHER` ends the run or leaves; `IF X = SPACES` before a use, and an
`EVALUATE` that only chooses what else to do, check nothing. A check that only sets a flag has run,
but the flag's later test is not read as stopping the value, so it lowers and does not clear. A sink
that another route reaches without the check keeps its full severity.

**What starts each program.** A finding carries `startedBy`: the CICS transactions the CSD defines
for its program (from a CSD extract or `DFHCSDUP` input), the job steps that run it (`EXEC PGM=`,
and `RUN PROGRAM` under a TSO batch step), and whatever those reach by `CALL`, `LINK`, `XCTL`, or
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
card, the program abends, and the finding says so and is one step lower. A bound on the index (`IF
WS-IDX > 10`) lowers it as any check does. File records and database values are not followed into
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
benchmark cases and no measured rate.

## CICS and CALL interfaces

**CICS checks.** A program that reads its communication area without ever checking `EIBCALEN`; a
transfer to a program named by a variable; a `LENGTH` longer than the area passed or than the
callee's own declaration. The last two need exact field sizes, which is what the parser is graded
on. A sign-on a program performs itself, bypassed: where a password comparison succeeds the program
transfers somewhere, and a route to that same program that does not pass the comparison - a PF key
the sign-on screen does not expect, a missing communication area - is a way in without a password.
Which comparison is the sign-on is read from field names (`PWD`, `PSWD`, `PASSW`), and a sign-on
that only sets a flag for a later test is not followed.

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

**Copybook shadowing.** Two copybooks answering to one name with different layouts, with the
programs that resolve each; a repository copy of a system copybook (`SQLCA`, `DFHAID`, …), which the
search path finds before the system's own.

**Hidden content, aimed at the agents now reading this code.** Payloads in the columns a compiler
ignores, comments that instruct their reader to ignore instructions or fetch a script, long encoded
runs, and characters that reorder or hide text.

**Mainframe credentials.** `rules/gitleaks-mainframe.toml` extends gitleaks with the shapes it has
no rules for: a RACF password on a JCL statement, a TSO logon, `ADDUSER` and `ALTUSER`, a credential
in a COBOL `VALUE` clause, `EXEC SQL CONNECT`, and `EXEC CICS SIGNON`.

gitleaks detect --no-git --source . --config "$(cobolwork --rules-path gitleaks)"

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

All three ship here because their instruments may be reproduced: one is EU law, two are US
Government works. PCI DSS and COBIT-derived material may not be redistributed.
