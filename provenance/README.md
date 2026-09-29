# Where the word lists came from

[`words.json`](words.json) records, for every word the parser recognises, which document attests it.
[`../lib/words.mjs`](../lib/words.mjs) is generated from this file and from nothing else, by
[`../diag/generate-words.mjs`](../diag/generate-words.mjs). `test/words-provenance.test.mjs` asserts
that the generated file equals what the generator produces, so a word cannot enter the parser's
vocabulary without a source behind it.

To add a word: add it here with its source, run `node diag/generate-words.mjs provenance/words.json
lib/words.mjs`, and commit both. Editing `lib/words.mjs` by hand fails the suite, which is the point.

[`precompile.json`](precompile.json) does the same for the precompiler: each CICS command it
translates, each option's argument type and direction with the manual page behind it, and the
numbers DFHRESP and DFHVALUE stand for. [`../lib/cics-commands.mjs`](../lib/cics-commands.mjs) is
generated from it and `words.json` by [`../diag/generate-precompile.mjs`](../diag/generate-precompile.mjs),
and `test/precompile.test.mjs` holds the two equal.

[`enterprise-options.json`](enterprise-options.json) is Enterprise COBOL 6.4's compiler-option table:
the 85 options in Table 45 of IBM's Programming Guide, each with its NO form, every abbreviation IBM
documents, and the rules on where it may be given, quoted with the page. [`../lib/enterprise-options.mjs`](../lib/enterprise-options.mjs)
and [`enterprise-options.tsv`](enterprise-options.tsv) are generated from it by
[`../diag/generate-options.mjs`](../diag/generate-options.mjs), and `test/enterprise-options.test.mjs`
holds them equal. The gate reads SSRANGE, NUMCHECK and PARMCHECK through it. ironwork vendors the TSV
and tests its own option parsing against it, which is the sharing both READMEs promise.

## Why it is done this way

The words are derived from online sources - the standards and each vendor's reference for its own
compiler - and validity-checked against this record, so the project can say where every word came
from. [`../LICENSING.md`](../LICENSING.md) and [`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)
say what that means for the licence.

## What a source has to be

A primary document: an ISO/IEC 1989 standard or public draft, or a compiler vendor's language
reference for its own compiler. Not another implementation's source code. Not a third party's list
with no citation.

Appearing in such a document is not enough on its own. A word is attested when the document is
**listing** it - a reserved-word table, a register or function table, a syntax diagram, a general
format, or a range stated in prose ("UPSI-0 through UPSI-7", which is expanded and the sentence
quoted). A word that appears only in running prose, in an example program, as a paragraph name, or as
part of a longer token is **not** attested and is dropped. `words.json` records the reason for every
drop.

## The gap, and what closes it

The words below are ISO/IEC 1989:2023 vocabulary. The 2023 and 2014 texts are paywalled and only their
**contents previews** are public - the reachable drafts stop at ISO/IEC 1989:20xx CD 1.2 (2009). Over
a public COBOL 2023 conformance suite in the test corpus their absence cost 26 `compile-undefined-name`
findings, all of them false.

Fifteen of them now rest on the GnuCOBOL Programmer's Guide, whose reserved-word table lists them for
its own compiler, several as reserved but not yet implemented: the four boolean shift operators,
`ANUM` `HEX` `NAT`, `ACTIVATING` `TOP-LEVEL`, `FLOAT-INFINITY` `FLOAT-NOT-A-NUMBER` and `PHYSICAL`,
with `CURRENT` `NESTED` `STACK` already attested elsewhere. Four have no source at all:
`FLOAT-NOT-A-NUMBER-SIGNALING` `FARTHEST-FROM-ZERO` `NEAREST-TO-ZERO` `IN-ARITHMETIC-RANGE`.

Buying **ISO/IEC 1989:2023 (CHF 227, iso.org catalogue 74527)** closes the four and puts the rest on
the standard itself. The 2023 edition supersedes 2014, so it is one purchase rather than two. The
clauses to extract, which a conformance suite written against the standard cites directly:

| Clause | Words |
|---|---|
| §8.8.2 rule 8, boolean shift operators, and Annex A Table A.2 | `B-SHIFT-L` `B-SHIFT-R` `B-SHIFT-LC` `B-SHIFT-RC` |
| §15.19 `CONVERT`; the source calls these §8.10 context-sensitive words | `ANUM` `HEX` `NAT` `BYTE` |
| `FUNCTION MODULE-NAME` arguments | `ACTIVATING` `TOP-LEVEL` `CURRENT` `NESTED` `STACK` |
| `SET CONTENT OF`, and the arithmetic and rounding clauses | `FLOAT-INFINITY` `FLOAT-NOT-A-NUMBER` `FLOAT-NOT-A-NUMBER-SIGNALING` `FARTHEST-FROM-ZERO` `NEAREST-TO-ZERO` `IN-ARITHMETIC-RANGE` |
| `LENGTH` / `BYTE-LENGTH` | `PHYSICAL` |

Also worth taking from the same text while it is open: §8.9 reserved words, §8.10 context-sensitive
words, §8.12 compiler-directive words and the exception-condition table, so the three clause-specific
sets rest on the current edition rather than on a 2009 draft.

**Reading a standard you have bought and recording which words it reserves is not a licensing problem.**
A reserved word list is a set of facts about a language, and language elements are outside copyright
protection - Directive 2009/24/EC art 1(2) and *SAS Institute v World Programming*. Copying another
implementation's data files would be a different act entirely.

Do not attest a word from the conformance suite itself. It is a third party's test code, it is not a
language description, and its fidelity cannot be checked from here. It is useful as a signal that a
word exists and as a pointer to the clause, which is how it was used above.

## Keeping the documents

A citation is worth what the document behind it is worth when someone checks, and a vendor manual
moves, is withdrawn, or survives only in the Wayback Machine. So every document the project cites is
kept, beside the record that cites it:

- [`words.json`](words.json) names the vendor manuals and standards behind the word lists, each with
  the SHA-256 of the bytes it was read from.
- [`sources.json`](sources.json) names the other documents cited (the CICS reference behind the
  witness's stand-in copybooks, the DORA, NIST and FFIEC texts behind the compliance mappings) and,
  for every publisher, the terms that govern keeping and republishing what it publishes, quoted.
- `node diag/sync-sources.mjs` fetches all of them into `feed/sources/`, which is never committed,
  and stores each file under its own SHA-256, so a page that changes upstream does not overwrite
  the copy a record was made from. A fetch that no longer matches its recorded hash is kept beside
  it, and the Wayback Machine's copy from the retrieval date is tried for the recorded one.
  `--mirror <dir>` copies the store to a backup; `--check` reads nothing from the network and says
  which recorded documents the store holds.

Keeping a private copy to check citations against, and republishing a copy, are different acts
with different answers. [`sources.json`](sources.json) records both, per publisher, with the clause
each answer rests on. Only documents whose licence permits redistribution may be republished: the
GnuCOBOL Programmer's Guide under the GNU FDL, and public-sector texts whose reuse terms allow it.
Vendor manuals and ISO texts stay private copies.
