# Security policy

## Reporting a vulnerability

Report privately through [GitHub's advisory form](https://github.com/Portll/cobolwork/security/advisories/new),
or by email to <john@portll.net>. Please do not open a public issue for a vulnerability.

Expect an acknowledgement within three working days and an assessment within ten. If a report is
valid, the fix and the advisory are published together, and you are credited unless you ask not to
be.

## Supported versions

cobolwork is before 1.0. The most recent release is the supported one; fixes are not backported.

## What counts as a vulnerability here

cobolwork reads source code it has no reason to trust — a repository under review, a pull request
from a stranger, a corpus pulled from the internet. Anything that lets such a file act outside the
scan is in scope:

- **Reading outside the tree.** A `COPY` that resolves outside the scanned directory, a symlink
  that escapes it, a path in a report that points somewhere it should not. Reaching outside the
  tree is refused and reported by design; a way around that refusal is a vulnerability.
- **Execution.** Anything that makes cobolwork run a command, load code, or open a network
  connection while scanning. It has no runtime dependencies and is not supposed to do any of these.
- **Resource exhaustion from a crafted source file.** A file that makes the parser or the flow
  analysis consume memory or time without bound. There is a source budget
  (`COBOLWORK_MAX_SOURCE_BYTES`) and a trace cap; a crafted input that defeats them is in scope.
- **A report that overstates coverage.** A file that cobolwork fails to read while still reporting
  `coverageIncomplete: false`. Silence that reads as a clean result is the failure this tool exists
  to prevent, so it is treated as a security bug rather than a defect.

## What does not count

- **A missed finding.** Recall is a measured property, not a vulnerability. Open an issue with the
  program that was not flagged; it is wanted, and it is how the benchmark grows.
- **A false positive.** Same: open an issue. Precision is measured, published, and improved in the
  open.
- **Findings cobolwork reports about your code.** Those are yours to fix, not ours to receive.

## Scope

This repository: the CLI, the library, and `rules/gitleaks-mainframe.toml`. Vulnerabilities in
GnuCOBOL, gitleaks or Node.js belong with those projects.
