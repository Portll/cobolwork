# Third-party notices

cobolwork is licensed under AGPL-3.0-or-later (see [`LICENSE`](LICENSE)). That licence covers the
project's own work. The material below is other people's, and is listed here with its licence and
where it came from.

Full licence texts are in [`licences/`](licences/).

---

## COBOL word lists

**Where:** [`lib/words.mjs`](lib/words.mjs), generated from
[`provenance/words.json`](provenance/words.json).

The reserved words, special registers, system names and intrinsic-function names are derived from
online sources - the ISO/IEC 1989 drafts and each vendor's published reference for its own compiler -
and validity-checked: every word names the document that attests it, and the test suite refuses a word
that is unattested or is not a well-formed COBOL word.

## AWS CardDemo BMS maps, copybooks and FTP job — Apache-2.0

**Where:**

| File | Lines | Origin in AWS CardDemo |
|---|---|---|
| [`test/fixtures/bms/COCRDSL.bms`](test/fixtures/bms/COCRDSL.bms) | 160 | `app/bms/COCRDSL.bms` |
| [`test/fixtures/bms/COSGN00.bms`](test/fixtures/bms/COSGN00.bms) | 213 | `app/bms/COSGN00.bms` |
| [`test/fixtures/bms/COCRDSL.cpy`](test/fixtures/bms/COCRDSL.cpy) | 204 | `app/cpy-bms/COCRDSL.CPY` |
| [`test/fixtures/bms/COSGN00.cpy`](test/fixtures/bms/COSGN00.cpy) | 156 | `app/cpy-bms/COSGN00.CPY` |

**Origin:** <https://github.com/aws-samples/aws-mainframe-modernization-carddemo>

**Copyright:** Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.

**Licence:** Apache License 2.0 — [`licences/Apache-2.0.txt`](licences/Apache-2.0.txt).

Copied unchanged, with Amazon's own licence header preserved in each file. They are test fixtures:
they are not in the `files` list in `package.json`, so they are not redistributed in the published
package. They are in the repository.

[`test/ftp.test.mjs`](test/ftp.test.mjs) reproduces the job card, FTP step and SYSIN lines of
CardDemo's `app/jcl/FTPJCL.JCL`, including its sample host addresses and logon, as the shape an FTP
rule must read.

## IBM interface-block layouts — IBM documentation

**Where:** [`lib/words.mjs`](lib/words.mjs) — `EIB_LAYOUT` (29 EXEC interface block fields with their
PICTURE clauses), `DIB_FIELDS` (10), `SQLCA_FIELDS` (23).

**Origin:** IBM CICS TS 6.x "EIB fields", IMS 15.3 "Specifying the DL/I interface block (DIB)", and
Db2 12 for z/OS "Description of SQLCA fields". Reserved-word and register names in the same file
also come from the IBM Enterprise COBOL for z/OS 6.4 Language Reference (SC27-8713-03).

These are interface facts a program must match to be read correctly — the same names and pictures
the CICS translator and the precompilers supply. They are transcribed from IBM's manuals, and IBM's
documentation is IBM's copyright.

[`rules/system-layouts.json`](rules/system-layouts.json) holds the SQLCA's elementary fields with
their offsets and lengths, from Db2 13 for z/OS "Description of SQLCA fields": the field order and
lengths are IBM's, and the offsets are summed from them to the 136 bytes the page states.

## Compiler option names — IBM documentation and GnuCOBOL's published usage

**Where:** [`lib/options.mjs`](lib/options.mjs), recorded with their sources in
[`provenance/compiler-options.json`](provenance/compiler-options.json).

**Origin:** the Enterprise COBOL for z/OS 6.3 and 6.4 documentation for `SSRANGE`, `PARMCHECK` and
`NUMCHECK`, their abbreviations and suboptions; and the `cobc(1)` manual page for GnuCOBOL 3.2's
`-fec`, `-fno-ec` and `-debug`. The exception-condition names are attested by ISO drafts in
[`provenance/words.json`](provenance/words.json).

These are names of options: interface facts, as the layouts above are. What each does is written in
this project's own words, and what each GnuCOBOL option does was established by compiling programs
with GnuCOBOL 3.2.0 and running them. Nothing was taken from GnuCOBOL's source files, word lists or
help text, which are GPL-3.0-or-later.

## Regulatory instruments — quoted clauses

**Where:** [`rules/compliance-dora.json`](rules/compliance-dora.json),
[`rules/compliance-nist80053.json`](rules/compliance-nist80053.json),
[`rules/compliance-ffiec.json`](rules/compliance-ffiec.json), and
[`feed/fixtures/sources/test-doc.txt`](feed/fixtures/sources/test-doc.txt).

About 4.2 KB of verbatim clause text in total, each quote matched against its instrument and carrying
its source URL and retrieval date:

- **DORA** — Regulation (EU) 2022/2554. EU law.
- **NIST SP 800-53 Rev. 5** — a work of the US Government.
- **FFIEC IT Examination Handbook** — a work of the US Government.

PCI DSS and the COBIT-derived SOX material are deliberately absent: they may not be redistributed,
so they belong in a licensed feed rather than in this repository. Full instrument texts are never
committed (`feed/sources/` is ignored); the feed ships citations, not text.

## Vulnerability data

**Where:** [`rules/advisories.json`](rules/advisories.json) — about 3.9 KB of CVE description text
across 15 advisories, retrieved from the NVD (a NIST publication; CVE List content is published by
MITRE under CC0). [`rules/kev-ids.json`](rules/kev-ids.json) — 1,716 CVE identifiers from CISA's
Known Exploited Vulnerabilities catalogue, identifiers only, no CISA prose.

## Contributor agreement

[`CLA.md`](CLA.md) is adapted from the Apache Software Foundation's Individual Contributor License
Agreement v2.0. The adaptation is disclosed in the document.

## Trademarks

CICS, IMS, Db2, z/OS and Enterprise COBOL are trademarks of IBM. ACF2, Top Secret and Connect:Direct
are trademarks of Broadcom. Control-M is a trademark of BMC. GnuCOBOL is a GNU project. All are used
nominatively, to say what this software reads and which products a rule concerns. No affiliation or
endorsement is claimed.

---

Something missing or wrong here is a bug: please report it the way [`SECURITY.md`](SECURITY.md)
describes for anything sensitive, or open an issue otherwise.
