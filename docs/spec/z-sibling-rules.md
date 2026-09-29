# The public record of z vulnerabilities, and how much of it a rule can reach

Status: five of its twelve designs are built; see section 6. Written for an engineer coming to it
cold: it assumes the codebase, not the discussion that produced it.

The study was measured against the working tree at 7949c7b, which then held 9 rule sets and 120
rules. The tree has moved: 13 sets, 145 rules, 62 test files and 94 benchmark cases as of the
commit that carries this line. Every corpus measurement in this document is over the same
127-repository public COBOL corpus; where an older number here says 125 or 126 it is counting a
different sample and says so.

Depends on: [`ruleset-contract.md`](ruleset-contract.md). Every rule proposed here is a
`defineRuleSet` adapter on the `SourceTree` port.

---

## 0. The question, and the answer

The question was how many publicly named and discussed z vulnerabilities could be covered by new
rules that catch the **sibling** of each - not the product defect, which only a patch fixes, but
the same mistake made in a customer's own COBOL, JCL, BMS map, CSD or site facts.

**187 publicly named z vulnerabilities were found. 83 of them (44%) have a sibling that twelve new
rules would report. 70 (37%) have a sibling this tool already reports. 34 (18%) leave nothing in a
repository to see.**

| | Advisories (NVD) | Named techniques | Total |
|---|---:|---:|---:|
| Sibling already reported | 65 | 5 | **70** |
| Sibling a new rule would report | 70 | 13 | **83** |
| Nothing in a repository to see | 26 | 8 | **34** |
| | **161** | **26** | **187** |

The corpus and every verdict are in [`feed/worklists/z-attack-classes.json`](../../feed/worklists/z-attack-classes.json).
`diag/sweep-z.mjs` re-runs the sweep and prints what the worklist does not hold, so the number
above is a measurement that can go stale and be caught going stale, not a claim.

## 1. Where the record is

IBM publishes z/OS product vulnerabilities through the IBM Z and LinuxONE Security Portal, which
needs registration and treats what it shows as confidential. Reading only that portal gives a
customer-supplied feed as the single route, and that was the assumption this study was asked to
test.

It does not hold. NVD returns **64 CVEs under `cpe:2.3:o:ibm:z\/os` alone**, and **161 across the
products a COBOL estate runs on** once CICS TS, CICS TX, TXSeries, Integration Bus for z/OS, App
Connect Enterprise, WebSphere on z/OS, IBM HTTP Server, the CICS Transaction Gateway, InfoSphere
Data Replication, Data Virtualization Manager and Tivoli NetView are included. The record is
public, machine-readable, free and has been all along.

One detail cost an afternoon and is worth writing down: the CPE is `cpe:2.3:o:ibm:z\/os`, and the
backslash is **part of the CPE**, not an escape. A query that loses it returns HTTP 404, which
reads exactly like an outage or a rate limit. `diag/sweep-z.mjs` holds the correct form.

Beyond NVD there is a second body of public knowledge that never became a CVE: mainframe security
research presented at SHARE, DEF CON, BlackHat and 44CON, and the tools published with it. Those
are the 26 named techniques in the table. They matter more than their count suggests, because a
technique with no CVE has no patch, and the only thing standing between an estate and it is how
the estate's own code is written - which is precisely what a rule reads.

## 2. Method

Each row is classified by what a customer artefact would show, not by what a patch would fix:

- **covered** - a rule in this tool already reports the sibling. Named with the rule id.
- **new** - a rule named in section 4 would report it.
- **patch** / **none** - the defect lives in product code or in a protocol, and there is nothing in
  a repository to see. A buffer overflow in a `gethostbyaddr` handler inside CICS TX is not visible
  from any COBOL program that calls it.

Where a CVE's CWE was absent, wrong or too coarse to decide, the description decided, and that
judgement is recorded against the individual CVE in the worklist so it can be argued with. 48 of
the 161 were classified individually for that reason - CWE-200 "information exposure" alone covers
five different mistakes, from a world-readable log to a cookie without the secure attribute.

**What this counting does not claim.** A sibling is not the same vulnerability. Reporting that a
program writes a tainted field into an HTML response does not patch CVE-2024-41746 in CICS TX; it
finds the place where the customer made the same mistake themselves. The claim is that 83 published
defects each describe a mistake that recurs in customer code and that nothing currently looks for
it there.

## 3. What the existing rules already reach

65 of the 161 advisories already have a sibling rule, which is the evidence that this approach
works rather than a hope that it might:

| Existing rule family | Advisories whose sibling it reports |
|---|---:|
| `*-to-web-response` | 30 |
| bounds family (`*-to-subscript`, `*-to-reference-modification`, `call-parameter-exceeds-*`) | 11 |
| `*-to-http-header` | 5 |
| `*-to-outbound-host` | 5 |
| `*-to-dynamic-file-path` | 3 |
| `*-to-dynamic-program-load` | 3 |
| the taint family generally | 3 |
| credential pack | 2 |
| `*-to-os-command` | 2 |
| `*-to-loop-bound` | 1 |

The single largest class in the whole public record is cross-site scripting: **29 of 161 CVEs carry
CWE-79**, and another handful are HTML or header injection under a different code. Every one of
them is a product repeating the mistake that `cics-web-to-web-response` and its siblings were
written for at 24ff411. The rule set built last week is aimed at the most-published class of
mainframe vulnerability there is, which was not known when it was built.

## 4. The twelve rules

Ordered by how many published defects each covers. Each states what it reads, what it reports, what
would make it wrong, and what has to be measured before it lands.

### N-PRIV - 18 defects

**A transaction, job or library runs at a privilege nothing in the repository says it needs.**

Reads: the CSD (`lib/csd.mjs` already parses `DFHCSDUP` output), JCL, and site facts.

Reports, as separate rules under one design:
- a `TRANSACTION` definition with `RESSEC(NO)` or `CMDSEC(NO)` whose program is reachable from
  `WEB RECEIVE` or a terminal;
- a definition or `PERMIT` naming `CECI`, `CEMT`, `CEDA`, `CEDF` or `CESF`;
- a job step that writes to a library another step or a `STEPLIB` loads from;
- `USER=` on a JOB card without the surrogate the site facts declare;
- an `IRRDBU00` step whose output DD is not a dataset the site calls restricted.

Covers: CICS transaction enumeration, default-transaction access (CICSPwn, NetSPI way 5), APF
library abuse, RACF database unload, surrogate job submission, USS UID 0, and eleven CVEs from
CWE-250, CWE-264, CWE-266, CWE-269, CWE-284, CWE-732 and CWE-922.

Wrong when: a site legitimately runs `CEMT` from a restricted terminal pool. That is what
`lib/site.mjs` is for - the declared fact demotes the finding rather than the rule guessing.

Measured: 22 repositories hold a CSD, 106 files, 1,330 transaction definitions that `lib/csd.mjs`
parses today, with 272 `RESSEC(NO)` and 271 `CMDSEC(NO)` occurrences to measure a rate against. The
artefact reaches far enough to carry the rule.

Two of the five sub-rules have no witness in the corpus: `IRRDBU00` appears in no repository, and no
repository names an APF-authorised library. Section 5b says what was done about that instead of not
writing them.

Two cautions the measurement produced. A CSD is not a file type - the 106 files include `.jcl`,
`.csd`, `.txt` and `README.md` - so whatever selects files for `lib/csd.mjs` must not filter by
extension, for the same reason the BMS count above was wrong once. And a `DEFINE` quoted in a README
is documentation, not an estate's configuration; some of those 1,330 definitions are examples, and
the rule needs to say which file it read rather than counting them all as live.

### N-IDENTITY - 11 defects

**A program takes the identity it authorises against from the request rather than from the system.**

Reads: the dataflow graph. A field that reaches a comparison guarding a state change, or that is
moved into a user-id field, and whose bytes came from `WEB RECEIVE`, `RECEIVE MAP`, `DFHCOMMAREA`
or a container - rather than from `EXEC CICS ASSIGN USERID` or `EIBTRMID`.

**Partly built, and the second rule this section proposed must not be.** `cics-signon-bypassed`
reports a route that reaches the program a sign-on grants without passing the password check, which
is 4 of these 11 rows: NetSPI way 6, CVE-2020-4821, CVE-2026-10845 and CVE-2026-14525.

The second rule proposed here was "a password compared with a literal, or with a field that can be
`SPACES` or `LOW-VALUES`". **Measured over 124 repositories, that shape is the defence and not the
defect.** A password field in an `IF` or `WHEN` appears in 33 repositories, and compared against
`SPACES` or `LOW-VALUES` in 21 of them, 144 times - and the ones read are all of this form:

```cobol
WHEN PASSWDI OF COSGN0AI = SPACES OR LOW-VALUES
    MOVE 'Y'      TO WS-ERR-FLG
    MOVE 'Please enter Password ...' TO WS-MESSAGE
```

That is the *rejection* path: the program refusing an empty password, which is the fix for
CVE-2020-4821 rather than the bug. Six distinct sites were read, across two unrelated repository
families - three in the CardDemo forks, two in an Italian CGI login program, one guard requiring
the field to be present - and every one denies. A rule on that shape would be almost entirely false
positives, and worse than noise: it would tell people to delete the check protecting them.

Deciding that took reading the branch body and the paragraph's default, never the comparison. One
site looked like the bug and is not:

```cobol
move "S" to w-exe-flg-sts                      *> default: granted
if pwd not = spaces and pwd not = stored  move "D" to w-exe-flg-sts  go to exit.
if pwd     = spaces and pwd not = stored  move "D" to w-exe-flg-sts  go to exit.
```

The two conditions together are one "deny on mismatch", so a blank password is refused unless the
stored one is blank too - which is a provisioning question and not this program's. What *would*
matter is the shape rather than the text: a paragraph that grants by default and denies in branches,
where any route reaching the exit without passing a branch is granted. That is a control-flow
property, and it is what `cics-signon-bypassed` already models.

The precondition this section asked for is not available either: `EXEC CICS SIGNON` or `VERIFY
PASSWORD` appears in **2 repositories of 124**, and `EXEC CICS ASSIGN USERID` in 2. Gating the first
rule on either would switch it off almost everywhere.

What is left unbuilt here is worth naming precisely, because it is not what this section first said:
identity taken from the request where a program does not sign anyone on - `CVE-2022-34164`'s shape,
one user impersonating another - plus session invalidation (CWE-613) and SOAPAction spoofing
(CWE-290). Those need the dataflow engine and a model of what an authorisation decision is, not a
name match.

### N-CRYPTO - 10 defects

**A connection or a cipher is requested at a strength the estate would not accept if asked.**

Reads: COBOL `CALL` statements to ICSF services (`CSNBENC`, `CSNBDEC`, `CSNBSYE`, `CSNBSYD`) and
their rule-array arguments; `EXEC CICS WEB OPEN` without `SSL`; CSD `TCPIPSERVICE` with `SSL(NO)`;
site facts declaring a TN3270 port without TLS.

**Built as one rule of the four this proposed, because three of the four have no witness at all.**
Measured over 124 repositories:

| what the design wanted to read | repositories |
|---|---:|
| any ICSF call (`CSNB*`, `CSND*`, `CSNE*`) | **0** |
| `EXEC CICS WEB OPEN` | **0** |
| a hardcoded initialisation vector | **0** |
| a CSD `DEFINE TCPIPSERVICE` | 4 |
| of those, accepting cleartext | **4 of 4** |

A DES or single-key rule-array literal appeared to have one witness and does not: the literal is
`"single"`, an ordinary English word in an unrelated program. So the cipher half of this design has
nothing to read, and `cics-listener-accepts-cleartext` is what shipped - a `TCPIPSERVICE` that takes
connections with `SSL(NO)`, or with no `SSL` attribute at all, which CICS defaults to the same
thing. Every listener in the corpus is one or the other: GenApp's `PROTOCOL(HTTP)` on port 4321 is
silent about SSL, and CBSA's z/OS Connect listener says `SSL(NO)` outright.

Reports 3 of these 10 rows: NetSPI way 1, reading the 3270 data stream off the wire, and
CVE-2023-50310, where the CICS Transaction Gateway transmits credentials by an insecure method. The
six CWE-327 rows are about cipher *strength* and CVE-2025-33142 about a weak TLS rather than an
absent one; neither is what this reads, and neither has an artefact in any repository to read it
from.

Still wanted, if an estate ever supplies the artefact: the ICSF rule array, where the computed case
is a `coverage` finding rather than a silent pass.

### N-LOG - 9 defects

**A field the credential pack recognises, or unescaped input, reaches a log, trace or error response.**

Reads: the dataflow graph, with three new sinks - `DISPLAY`, `EXEC CICS WRITEQ TD` to a queue the
CSD maps to a print or log destination, and `EXEC CICS WRITE JOURNALNAME`. Plus `EXEC CICS ABEND`
and the response path when what reaches it is a system field rather than a message the program
chose.

Reports: a credential-shaped or PAN-shaped field reaching one of those sinks (CWE-532, CWE-310); a
field from outside reaching one without a class test, so CR/LF can forge a log line (CWE-117); a
`RESP`/`RESP2`/`SQLCODE` value reaching a web response (CWE-209).

Covers: CWE-532 (3), CWE-117, CWE-310, CWE-209, CVE-2010-2323, CVE-2023-33848, CVE-2023-50311.

Wrong when: the field is named like a credential and is not. The credential pack's existing
name-and-shape test already carries that error rate and it is measured.

### N-RECVLIMIT - 8 defects

**Input is received or storage acquired with no length the program chose.**

Reads: `EXEC CICS WEB RECEIVE` and `RECEIVE` without `MAXLENGTH`; `GETMAIN FLENGTH(x)` where `x`
came from outside; `READQ TS` in a loop whose bound came from outside.

Covers: CWE-400 (partly), CWE-770 (3), CWE-776, CVE-2021-38951, CVE-2023-42031, CVE-2024-22332.

**Not built, and on the measurement it should not be.** `*-to-loop-bound` and
`*-to-occurs-depending-count` landed at 7949c7b and already take the counting half. The receive and
storage half, measured over 124 repositories, has nothing to report:

| what the design wanted to read | result |
|---|---|
| `EXEC CICS WEB RECEIVE` | **0 repositories** |
| `EXEC CICS RECEIVE ... INTO` without any bound | **0 statements** |
| `EXEC CICS RECEIVE ... INTO` with `LENGTH` | 41 |
| the same with `MAXLENGTH` | 2 |
| `EXEC CICS GETMAIN FLENGTH(field)` | 2 repositories |

`LENGTH` on a `RECEIVE` is both the maximum in and the actual out - it *is* the bound the design
asked for, in the spelling COBOL written before `MAXLENGTH` existed. Reporting its absence would
have reported 175 statements that turned out to be `RECEIVE MAP`, where BMS supplies the length and
no buffer of the program's is at risk. Two measurement errors produced that 175: a negative
lookahead that backtracked through `\s+` and so failed to exclude `RECEIVE MAP`, and sequence
numbers in columns 73-80 splitting `RECEIVE` from `MAP`. The corrected count of unbounded receives
is zero.

What is left is `GETMAIN` with a length from outside, which is two repositories and is a dataflow
sink rather than a construct - it belongs in the `*-to-*` family the flow engine owns, not here.

### N-XXE - 7 defects

**A document from outside is parsed as XML with entity and expansion handling left to the default.**

Reads: COBOL `XML PARSE`, `EXEC CICS TRANSFORM DATATOXML` / `XMLTODATA`, and the `DFHLS2JS` /
`DFHJS2LS` generated wrappers, over a field whose bytes came from outside.

Covers: CWE-611 (6), CWE-776.

**Not built: nothing in the corpus parses XML.** The grading against Enterprise COBOL that this
section made a precondition was never the blocker. Measured over 124 repositories:

| | repositories |
|---|---:|
| `XML PARSE` | **1**, and it is a language server's own test fixtures |
| `EXEC CICS TRANSFORM` | **0** |
| `DFHLS2JS` / `DFHJS2LS` wrappers | 2, both z/OS Connect samples |
| `XML GENERATE` | 26 |

`XML GENERATE` is the common one and it writes rather than reads, so no document from outside
reaches it. The one repository with `XML PARSE` is `eclipse-che4z`, whose matches are `case100.cbl`
and `case_xml_parse.cbl` under `__tests__` - fixtures for parsing COBOL that parses XML, not an
application that does.

The design stands if an estate ever supplies the artefact, and the caution stands with it: the
finding would be about expansion and about what the code does with `XML-EVENT`, not about entity
resolution, and it needs grading against the compiler before it ships.

### N-COOKIE - 6 defects

**A cookie or a URI carries a credential without the attributes that keep it off the wire.**

Reads: `EXEC CICS WEB WRITE HTTPHEADER` where the name is `Set-Cookie` and the value literal omits
`Secure`, `HttpOnly` or `SameSite`; and a URI built for `WEB OPEN` or `WEB CONVERSE` whose query
string is fed by a credential-shaped field.

Covers: CWE-311 (2), CVE-2022-34307, CVE-2022-34311, CVE-2022-34313, CVE-2023-33847, CVE-2023-33849,
CVE-2023-38363.

This is the cheapest rule in the set - a literal check on a header the program writes - and it
covers six published defects. Build it first.

### N-CSRF - 5 defects

**A request from the web changes state without the program comparing anything the browser could not forge.**

Reads: a path from `WEB RECEIVE` to a state change (`WRITE`, `REWRITE`, `DELETE`, `EXEC SQL
UPDATE/INSERT/DELETE`, `START TRANSID`) with no comparison on the way against a field the program
generated.

Covers: CWE-352 (5).

**Not built: the source half does not exist here.** `EXEC CICS WEB RECEIVE` is in **0 of 124
repositories**, the same result that governs N-COOKIE and N-HEADERS. The sink half is everywhere -
187 files in 28 repositories perform a `WRITE`, `REWRITE` or `DELETE`, and 15 files in 7 use `START
TRANSID` - but a state change is not a finding without a request that reached it from the web.

This is the one of the three unbuildable designs that is unbuildable only *here*: unlike N-RECVLIMIT,
whose defect does not occur, and N-XXE, whose construct does not appear, N-CSRF is a path from a
source to a sink and both halves are ordinary on a customer estate. It needs the flow engine, and it
should be built when someone has a repository that uses the CICS web API at all.

The caution stands: the token may be checked in a different program reached by `LINK`, and
cross-program guards are what the guard model refuses to invent, so it reports at `med` with
evidence `advisory` and says what it could not follow.

### N-HEADERS - 5 defects

**An HTML response goes out without the headers that decide who may frame, script or link to it.**

Reads: a program that sends an HTML `DOCUMENT` or `WEB SEND` and the set of `WRITE HTTPHEADER`
calls on the same path. Reports the absence of `Content-Security-Policy`, `X-Frame-Options` or
`X-Content-Type-Options`, and `<a target="_blank"` emitted without `rel="noopener"`.

Covers: CWE-1021 (2), CVE-2022-38705 (reverse tabnabbing), CVE-2022-34329, CVE-2022-33955.

Wrong when: a front-end proxy adds the headers. Site facts should be able to declare that, and the
rule demote to `info`.

### N-ORACLE - 2 defects

**Two failure paths answer differently, so the answer tells the caller which one it took.**

**Built, and the rate is what made it buildable.** This section asked for the false-positive rate
before the rule was written, and getting it changed the design. Keyed on failure messages the corpus
has 2,361 files in 103 repositories - unusable. The discriminator is not that a program has an
error message but that it has *two different ones* for the two halves of one decision:

| | programs | repositories |
|---|---:|---:|
| a message for the user and a different one for the password | **19** | 18 |
| one message answering both | 6 | 6 |

`cics-signon-says-which-half-failed` reports the first. The second is the fix, it is in the corpus
independently of the first - the CardDemo forks against a set of student projects that get it right
- and it is the negative benchmark case. The precondition is the one
`cics-signon-bypassed` already uses: a program with no password-named field is not answering a
sign-on, so "User not found" on a lookup screen tells nobody anything.

One implementation note worth keeping. The words are compared by splitting the message, not by a
regex: a word-boundary escape written into `lib/sets/cics.mjs` became a literal backspace byte, the
regex then matched nothing, and every test still passed. `test/source-text.test.mjs` caught it.

### N-CONNSTR - 1 defect

**A connection string or URL is built from a field that came from outside.**

Reads: the dataflow graph, with a sink on fields whose name or literal content matches a JDBC, MQ
or Db2 connection-string shape.

Covers: CVE-2024-52899 (JDBC URL parameter injection in Data Virtualization Manager for z/OS).

**Not built: the shape it names is not written in COBOL.** A JDBC or DSN-shaped literal appears in
**0 of 124 repositories**. What does appear is `EXEC SQL CONNECT` in 6 and `MQCONN`/`MQCONNX` in 2,
which is a different thing: the connection is named by a host variable or a queue-manager name, not
assembled into a URL. A rule for those is a dataflow sink on the `*-to-*` family rather than a
construct here, and it is one row - the smallest return in the whole study.

### N-BMS - 1 defect, and the largest class of technique

**A BMS map marks a field protected, dark or numeric, and the program trusts the value that comes back.**

Reads: **BMS map source**, which this tool does not parse at all today - `DFHMSD`, `DFHMDI`,
`DFHMDF` and the `ATTRB=` operand - paired with the symbolic map copybook and the program that
issues `RECEIVE MAP`.

Reports: a field whose map attributes are `PROT`, `ASKIP`, `DRK` or `NUM`, whose value the program
reads after `RECEIVE MAP` and uses without a class test - as a subscript, a length, a dataset name,
a price, an account number or a comparison that decides authorisation.

This is one CVE and the whole of the 3270 field-tampering technique class: hack3270, the hacked
`wc3270`, and NetSPI ways 3 and 4. A 3270 field attribute is enforced by the **emulator**, not by
CICS. Change the emulator and every protected field is writable and every dark field is visible.
The entire defence is the assumption that the terminal is obedient, and that assumption is a
client-side trust boundary exactly like a hidden HTML form field - a thing every web scanner has
reported since 2004 and no mainframe scanner reports at all.

It is last in this list by defect count and first by value. It needs `lib/bms.mjs`, which
[`language-coverage.md`](language-coverage.md) already specifies as a parser with no oracle - z390
ships no `DFH` macro libraries - so it is graded by round-trip and hand-built fixtures, and the
README has to say so.

## 5. What no rule reaches

34 rows, and they are worth naming so a clean result over them is not read as a clean bill of
health:

- **Memory corruption in product C code.** `gethostbyaddr` and `gethostbyname` overflows in CICS TX
  (CVE-2025-1329, CVE-2025-1330), `gets` in the same product (CVE-2025-1331), the Eclipse OMR
  `atoe` buffers. A patch fixes these; nothing in a COBOL program predicts them.
- **Unspecified vulnerabilities.** Nine rows from 2006-2012 whose description is "unknown impact and
  attack vectors". There is nothing to build a sibling from.
- **Deserialization in the Java tier** (CWE-502) - off-mainframe, and covered by
  `build-pins-vulnerable-component` when the tier is pinned in a build file this tool reads.
- **Protocol and network facts**: NJE node spoofing, VTAM APPLID and LU enumeration, FTP brute
  force and wildcard dataset enumeration, weak password policy in the security manager. These are
  configuration of a running system, and a repository does not hold them - though
  [`lib/site.mjs`](../../lib/site.mjs) is where a customer could declare them if they wanted the
  scan to judge them.

## 5a. What the public corpus can witness, measured

Measured 2026-09-24 over the 127-repository corpus, 143,081 files read across COBOL, BMS, JCL and
assembler extensions:

| Artefact | Repositories | Files |
|---|---:|---:|
| `EXEC CICS` (control) | 42 | 111,200 |
| `EXEC CICS SEND MAP` | 34 | 6,727 |
| `DFHMSD` (BMS map source) | 31 | 1,503 |
| `DEFINE TRANSACTION` (CSD) | 22 | 106 |
| `RESSEC(` / `CMDSEC(` | 16 / 14 | 45 / 43 |
| `CECI`, `CEMT`, `CEDA` named | 20 | 152 |
| `DEFINE TDQUEUE` | 12 | 14 |
| `SURROGAT` or a JOB card `USER=` | 6 | 33 |
| `BPX.SUPERUSER` or `UID(0)` | 4 | 4 |
| `IRRDBU00` | **0** | **0** |
| APF-authorised library named | **0** | **0** |
| HTML in a COBOL literal | 16 | 126 |
| `EXEC CICS WEB` (any) | **0** | **0** |
| `WRITE HTTPHEADER` | **0** | **0** |
| `DOCUMENT CREATE` / `INSERT` | **0** | **0** |

The file set matters as much as the count. A sweep restricted to COBOL extensions reports no BMS
source at all, because `.bms` is not a COBOL extension; the row above is what the corpus actually
holds, and it holds 25,701 `DFHMDF` field definitions.

**No public repository in this corpus uses the CICS web API.** Every rule that reads `EXEC CICS WEB`
- N-COOKIE, N-HEADERS, N-CSRF, the web half of N-RECVLIMIT and N-XXE - can be given benchmark cases
and hand-built fixtures, and cannot be given a false-positive rate. The control line is what makes
this a finding rather than a broken measurement: 42 repositories use `EXEC CICS`, so the reader
works and the absence is real. CICS web programs exist in quantity on customer estates and are
absent from public GitHub, which is the same gap `BACKLOG.md` records for `BPXWDYN` and
`DISPLAY UPON CONSOLE`. These rules ship as `construct` evidence with a benchmark case and an
honest note, or they wait for a practitioner.

**N-BMS is the best-witnessed rule in the set.** 31 repositories commit BMS map source, 25,701
field definitions in all, and 34 send maps from COBOL - so the join the rule depends on, from a
`DFHMDF` attribute to the symbolic map field a program receives, can be measured on real code
before a line of the rule is written. It is the only one of the twelve with that.

The three repositories that send maps without committing the source are the case the rule still has
to survive: maps often live in a separate change-managed library that does not travel with the
COBOL. So N-BMS reports at full strength where both the `DFHMDF` attributes and the symbolic map
are read, and says which half was missing otherwise, rather than going silent.

## 5b. A check nothing in a repository can witness

The first draft of this document said a rule with no corpus witness should not be written. That is
the wrong rule for two of the checks here, and the reason is worth stating because it recurs.

Whether a library is APF-authorised lives in a running system's `PROGxx` member. Whether a dataset
is readable by everyone lives in RACF. Neither fact is in any source file, so **no corpus of any
size will ever witness them**. That is a different situation from `EXEC CICS WEB`, which is absent
from public GitHub but present on customer estates and would appear in a better corpus. Waiting for
evidence that cannot arrive is not caution; it is a way of never shipping a check that matters.

Five things can be done with such a check. Four of them are worse than the fifth:

- **Ship it anyway at full severity.** The false-positive rate is not merely unmeasured, it is
  certain to be high: every job with a `STEPLIB` would be reported. This is what the rule set
  avoids.
- **Ship it in an opt-in pack**, as the vendor packs already do for rules with no measured rate.
  Honest, but it puts the check where nobody turns it on.
- **Measure recall only**, by planting faults with `bench/seed.mjs`. Recall is genuinely measurable
  without a corpus - planted twenty, found twenty - and it is half a number, correctly labelled. It
  is worth doing and it does not answer the precision question.
- **Emit the finding with a coverage note** saying its rate is unmeasured. Better than silence,
  but a reader who sees the finding still cannot act on it.
- **Gate it on the fact, and observe until the fact arrives.** This is what was built.

`cobolwork.site.json` now takes `apfLibraries`, `restrictedDatasets` and `surrogateUsers`. Until an
estate supplies them, **two of the three** checks report what the job *does* - "this job runs
IRRDBU00, which unloads the security database" - as `context` evidence, which this project defines
as describing the estate and asserting no defect. The detail names the fact that would decide it.
Once the estate answers, the same observation becomes a defect with a severity: "this job writes the
unloaded security database to `PUBLIC.RACF.UNLOAD`, which is not under any prefix the estate calls
restricted".

The third, `job-loads-from-an-authorised-library`, is declared `high`/`construct` and says nothing
at all until `apfLibraries` is declared. The difference is not an inconsistency, it is the rule
being honest about what it has: a job that unloads the security database, or that names the user it
runs as, is worth reporting on its own; a job that loads from a STEPLIB is not, because every job
does. Observing that would be noise, not observation. What the set reports instead is that it did
not judge - `notLooked` names the fact and the number of statements waiting on it - which is a
different claim from observing without asserting, and needs a different declaration to stay true.

Three properties make this better than the alternatives. The false-positive rate is **zero by
construction** until someone supplies ground truth, because nothing is asserted. The reader is never
shown silence they might read as a clean result - `factsNotDeclared` names each fact the estate has
not given, the way `advisoryCoverage` names each product nobody searched. And the work of answering
falls on the only party who can: an estate can state its APF list in a minute, and no analysis of
its source code could ever derive it.

This generalises. Any check whose deciding fact lives outside the repository belongs here rather
than in the backlog - `N-CRYPTO`'s TN3270 ports, `N-IDENTITY`'s sign-on programs and the rest of
`N-PRIV`'s surrogate authority are all the same shape.

## 6. Order of work

**Built.** Nine of the twelve have shipped a rule, and shipping a rule for a design does not report
every row it carries - see the table below the next one.

| Rule | Shipped as | Evidence |
|---|---|---|
| N-COOKIE | `web-cookie-without-secure-attributes` | benchmark case only; no repository in the corpus uses the CICS web API |
| N-HEADERS | `web-response-without-protective-headers`, `web-link-opens-without-noopener` | as above |
| N-BMS | `cics-protected-field-to-record-key` (med), `cics-protected-field-to-record-update` (high) | 3 findings on CardDemo, all cross-program, plus bench 083-086 |
| N-PRIV | `csd-defines-diagnostic-transaction`, `csd-transaction-without-command-security`, and three site-gated checks (section 5b) | 22 repositories hold a CSD, 1,330 transaction definitions; bench 089 |
| N-LOG (construct half) | `log-writes-a-credential`, `log-writes-personal-data` | 11 true positives in 5 repositories of 22,800 DISPLAY statements; bench 087-088 |

**How much of the record this now reaches: 113 of 187, or 60%.** That is the 70 rows an existing
rule already covered plus the 43 that a shipped rule reports a sibling of.

The first version of this line said 109 and 58%, by counting every row of a design that had shipped
any rule. That is an overstatement and it was mine: N-PRIV carries 18 rows and has five rules, and
nothing in the tool reports a started task holding more access than its steps use, or USS privilege
escalation to UID 0. Each row now carries `reportedBy`, naming the rules that report it, and
`diag/check-worklist.mjs` counts rows:

| design | rows | reported |
|---|---:|---:|
| N-BMS | 1 | 1 |
| N-LOG | 9 | 7 |
| N-PRIV | 18 | 6 |
| N-COOKIE | 6 | 5 |
| N-IDENTITY | 11 | 4 |
| N-HEADERS | 5 | 3 |
| N-CRYPTO | 10 | 3 |
| N-ORACLE | 2 | 2 |
| the four with no rule yet | 21 | 0 |

`check-worklist` exits non-zero on any disagreement between the worklist, this document and the
live rule catalogue, and `test/z-worklist.test.mjs` runs it - three separate reviewers re-added
70/83/34 by hand in the week after this was written, which is the diagnostic rather than the
reassurance.

### And the 86 rows no rule reports

Every one now says why, and the answer corrects section 0. "Coverable by a new rule" was a
judgement made before any of the twelve designs was measured, and for a third of those rows the
measurement has since falsified it.

| | rows | |
|---|---:|---|
| reported today | **113** | 70 by a rule that already existed, 43 by one built for this |
| needs a fact only the estate can supply | **2** | a started task's access, and which transactions a stranger can reach |
| no customer artefact at all | **72** | the original 34, plus **38** whose verdict of `new` the measurement disproved |

So the honest restatement of section 0 is that **115 of the 187 were ever coverable**, not 83 - the
first estimate was low on what a rule could reach and high on which rows had a sibling at all. The other 33 were classified from a CVE
description before anyone had looked for the artefact - six CWE-327 rows about cipher strength where
ICSF appears in no repository, two Curam session-invalidation rows where a pseudo-conversation has no
session to invalidate, a WebSphere SAML interceptor, a TSM Java GUI. Each row carries its own reason
in `whyNotReported`, and `check-worklist` refuses a row that gives a kind without one.

The nineteen that were reachable are now five rules, and two refusals.

| built | rows it took |
|---|---|
| `web-response-without-protective-headers` gained `Cache-Control` | CVE-2022-33955, a back-and-refresh attack |
| `web-response-tells-the-caller-what-it-runs` | CVE-2022-34329: a header that leaks rather than one that is absent, read from the same statement |
| `web-uri-carries-a-credential` | CVE-2023-33849, and any program that `STRING`s a credential-named field into a URI |
| `web-request-changes-state-without-a-token` | all five CWE-352 rows; `advisory`, because it cannot follow a token checked in another program |
| `job-writes-diagnostic-output-unrestricted` | CVE-2010-2323 and CVE-2022-34312, plus every dump, trace and unload in 5 corpus repositories |
| `job-reaches-unix-system-services` | CVE-2012-5951 and USS privilege escalation to UID 0, from 2 repositories running `BPXBATCH` |

Two were refused on measurement rather than built, and both are the shape this study keeps finding:

**A sign-on with no attempt counter.** All **71** CICS programs in the corpus with a password field
name no counter - because counting attempts is the region's and RACF's job, not the program's. A
rule firing on 71 of 71 describes COBOL rather than a defect.

**A debug switch left on.** A `PARM` naming `TEST`, `DEBUG` or `CEDF` appears in **0** of 124
repositories.

A third was reclassified rather than built. *CICS transaction enumeration* looked like an extension
because `lib/csd.mjs` already parses every `DEFINE TRANSACTION`; it is not, because the CSD never
says which transaction a stranger can reach, and without that the only available test is `RESSEC(NO)`
- the CICS default, which would report all 1,330 definitions in the corpus.

N-BMS is the one to read if only one is read. It reports a key the program kept in a field the BMS
map marks protected, dark or skip, which a modified emulator can edit, where that key chooses a
record. All three CardDemo findings cross an XCTL, which needed the flow engine to resolve a
program name held in a variable before any of them existed - CardDemo names 23 of its 25 transfer
targets that way, so the engine had been carrying no communication area across any of them.

The severity split is worth keeping in mind when writing the rest. The first draft reported every
key at one severity; the second escalated any `READ ... UPDATE`, which is wrong, because CardDemo's
view program reads its transaction for update and never changes it. What the rule reports at high is
a `READ ... UPDATE` whose held record the same program then `REWRITE`s or `DELETE`s by the same
dataset operand, or a `DELETE` by `RIDFLD`. The question a severity answers is not what the user may
see - an unscoped list already answers that - but what they may alter.

Both of the rules added since carry a lesson the remaining nine should inherit. `RESSEC(NO)` and
`CMDSEC(NO)` are CICS' *defaults*, so reporting them alone reports all 1,330 transaction definitions
in the corpus and means nothing; what makes a missing `CMDSEC` a finding is that the program issues
the commands `CMDSEC` governs. And N-LOG is entirely its matcher: measured over the corpus, a
substring match scored a 67% false-positive rate by matching `PAN` inside `COMPANY-NAME`, and
including `ACCT-NO` as a personal-data signal made it 92% wrong, because an account number in COBOL
is a chart-of-accounts code. Both were caught by measuring before writing, which is the only reason
this section can give either a number.

**Next**, in the order their preconditions can be measured rather than the order they were designed:

1. **N-LOG's taint half** - CWE-117, input reaching a log without a check, and CWE-209, a `RESP` or
   `SQLCODE` reaching a web response. Two sinks on the flow engine.
2. **N-IDENTITY**, **N-CRYPTO**, **N-RECVLIMIT** - each needs a precondition that keeps its false
   positives down, and each precondition needs measuring first. N-IDENTITY has the same shape as
   N-BMS and should reuse its lesson: the finding is not that a program reads an identity from the
   request, it is what the program then does with it.
3. **N-XXE** - blocked until `XML PARSE` entity behaviour is graded against Enterprise COBOL.
4. **N-CSRF**, **N-CONNSTR**, **N-ORACLE** - after the false-positive rates above are known.

Nothing here should land as a `path`-evidence rule without a benchmark case and a corpus
measurement. The count in section 0 is a count of *opportunity*, not of rules that work; a rule
with a false-positive rate nobody measured covers nothing. Two of the three built so far have no
measurable rate and say so, which is the honest form of that, not an exception to it.
