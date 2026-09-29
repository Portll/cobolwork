# Licensing

cobolwork is published under **AGPL-3.0-or-later**. That is the licence in [`LICENSE`](LICENSE), the
one in `package.json`, and the one every published artifact carries. If AGPL works for you, take it:
nothing here asks you to talk to us first.

Other terms are available on application, for organisations whose policy will not approve AGPL. This
page says what those are, what they cost you in guarantees, and what a grant does and does not reach.
It is written so that a reviewer can read it once and decide.

## If you are reading this because AGPL was refused

Two things are worth knowing before you ask for anything.

**Running cobolwork over your own source almost certainly triggers nothing.** cobolwork is a
command-line scanner. It does not serve a network interface, so the AGPL's §13 — the clause that
separates it from GPL — has nothing to act on. Unmodified internal use owes you no obligation beyond
keeping the notices. If your reviewer's objection is "AGPL means we must publish our source", that is
not what this licence does here, and the cheapest path is to show them that sentence.

**What actually needs other terms** is modifying cobolwork and not publishing the modifications;
embedding it in something you ship; offering it to third parties as part of a product or a service;
or an internal policy that refuses copyleft on sight regardless of what the clauses say. That last one
is a real constraint and we do not argue with it.

## What is on offer

| | For | Terms |
|---|---|---|
| **Public** | Anyone | AGPL-3.0-or-later. Free. No application, no conversation. |
| **Evaluation** | Assessing it before committing | [PolyForm Free Trial 1.0.0](https://polyformproject.org/licenses/free-trial/1.0.0/), unmodified |
| **Internal use** | An organisation running it over its own code, whose policy refuses AGPL | [PolyForm Internal Use 1.0.0](https://polyformproject.org/licenses/internal-use/1.0.0/), unmodified |
| **Everything else** | Redistribution, embedding, OEM, delivery inside a consultancy engagement | Negotiated commercial licence |

PolyForm Internal Use does not permit you to offer the software to third parties. If you are a
consultancy or a modernisation partner wanting to run cobolwork inside client engagements, that is
the negotiated tier, not the internal-use one.

We do not offer PolyForm Noncommercial or PolyForm Small Business. Anyone eligible for either can
already take AGPL for nothing, so the tier would exist only to look generous.

**A PolyForm grant is not the same product as a commercial contract.** PolyForm licences are
as-is: no warranty, no indemnity, no liability cap, no confidentiality, no support commitment. If your
vendor-onboarding process requires those — most banks' does — you want the negotiated tier. Ask for
it directly.

**None of the alternative tiers is open source.** PolyForm licences are source-available and are not
OSI-approved. The AGPL distribution is open source; a PolyForm grant is not, and we will not describe
it as one.

## The word lists

[`lib/words.mjs`](lib/words.mjs) holds the COBOL reserved words, registers, system names and intrinsic
functions the parser recognises. They are derived from online sources - ISO/IEC 1989 drafts published
by JTC 1/SC 22/WG 4 and by INCITS, and the language references of IBM, Micro Focus, ACUCOBOL-GT,
RM/COBOL, Fujitsu, BS2000, Bull GCOS and Veryant - and validity-checked.
[`provenance/words.json`](provenance/words.json) records, for every word, which document attests it,
with that document's URL, retrieval date and SHA-256. `lib/words.mjs` is generated from that record and
from nothing else, and a test in the suite asserts the two agree and that every word is a well-formed
COBOL word, so no word can enter the parser's vocabulary without a source behind it.

### What a grant conveys

A grant on terms other than AGPL conveys a release artifact or a tagged source tree.

### What still needs a practitioner

One question should be answered in writing before money changes hands. Whether a compiler's word list
attracts copyright at all is open: IceTV v Nine Network [2009] HCA 14 and Telstra v Phone Directories
[2010] FCAFC 149 refuse sweat-of-the-brow compilation copyright, and Directive 2009/24/EC art 1(2) with
SAS Institute v World Programming put a language's elements outside protection. A paid grant reads as a
warranty of title over the whole work, and a warranty deserves an opinion rather than a confident
paragraph.

## Contributions

[`CLA.md`](CLA.md) governs contributions, and CLA assistant asks each contributor to sign it on their
first pull request. It permits this dual arrangement, which is the point of it: without a CLA,
a single outside contribution would make every alternative tier impossible from that day, because
each contributor would hold rights nobody could relicense.

## Asking

Write to <john@portll.net> with: your organisation, which tier you think you need, what you intend to
do with cobolwork, and — if your policy refuses AGPL — the clause your reviewer objects to. That last
one saves a round trip and occasionally saves the whole conversation, because the objection is often
to something the AGPL does not require here.

---

*This page describes an intention to license and is not itself an offer, a contract or legal advice.
Each grant is a separate agreement, made against a release artifact or a tagged tree rather than
against this repository's history, for the reason given above.*
