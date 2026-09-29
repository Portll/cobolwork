# Contributing

## The agreement

Every contributor signs the [Contributor Licence Agreement](CLA.md) once, before their first
change is merged. It is a licence, not an assignment: you keep the copyright in what you write.
It is governed by the law of South Australia, and the grantee is John Hancock trading as Portll,
passing to Portll on incorporation under section 9 without contributors needing to be asked again.

It exists because cobolwork is offered under two licences — AGPL-3.0-or-later, and a commercial
licence for those whose policy or product cannot accept the AGPL. Offering both requires one party
to hold the right to license the whole work under either, and a contribution's copyright stays
with its author unless they grant otherwise. One unagreed contribution ends the arrangement for
the whole project.

Section 8 of the CLA is the reciprocal half: everything merged stays under AGPL-3.0-or-later
permanently, and the open distribution cannot be withdrawn.

A Developer Certificate of Origin sign-off is **not** sufficient here. The DCO certifies that you
had the right to submit the work; it grants no right to relicense it.

## How to sign

On your first pull request, CLA assistant comments with a link. Follow it, sign in with GitHub,
give your name and email address, and agree; the pull request's `license/cla` check then passes.
Nothing is merged until everyone who committed to the pull request has signed.

Contributing on behalf of an employer, or as a company: an authorised signatory should sign
instead, naming the individuals covered. Contact john@portll.net.

Once recorded, it covers everything you send afterwards. If the agreement's text changes, CLA
assistant asks again on your next pull request.

## What a change needs

- **Tests pass.** `npm test`. A test that needs an absent tool records a skip naming it; a skipped
  check is not a passing one.
- **No dependencies.** cobolwork has none, runtime or development, and that is a property worth
  keeping. A change that needs one needs a reason first.
- **A new rule brings benchmark cases.** One positive and one near-miss negative in `bench/cases/`,
  labelled with its CWE, following the pairs already there. `npm test` fails if a case scores
  differently from its declaration.
- **A parser change is regraded.** `npm run diag:grade` against GnuCOBOL. The parser is measured
  against `cobc -t -Xref -ftsymbols`, and that number is the project's credibility.
- **Coverage stays honest.** Anything cobolwork could not read belongs in the report. A finding
  count over fields nobody read is not a clean result.

## What is most useful

[BACKLOG.md](BACKLOG.md) lists open work with what each item was measured against and what
finishing it would show. Items near the top of each section are the ones that matter.

## Reporting a vulnerability

Do not open a public issue. Email john@portll.net.
