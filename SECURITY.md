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
- **Execution.** Anything that makes cobolwork run a command the scanned source or the scanned
  repository names, load code, or open a network connection of its own. The programs cobolwork
  does start are fixed by the command and option used, and are listed in the table below.
- **Resource exhaustion from a crafted source file.** A file that makes the parser or the flow
  analysis consume memory or time without bound. There is a source budget
  (`COBOLWORK_MAX_SOURCE_BYTES`) and a trace cap; a crafted input that defeats them is in scope.
- **A report that overstates coverage.** A file that cobolwork fails to read while still reporting
  `coverageIncomplete: false`. Silence that reads as a clean result is the failure this tool exists
  to prevent, so it is treated as a security bug rather than a defect.

## What each command reads, writes and starts

"Starts" means a child process cobolwork launches. `git` is always run as read-only plumbing with
`core.fsmonitor` off, and never as a porcelain command that could run a filter named in the
repository's own configuration. cobolwork opens no network connection itself; the two ways a
started program reaches the network are marked. Every command that takes `--evidence <dir>` (or
`COBOLWORK_EVIDENCE`) also writes its journal and ledger there, never inside the tree it reads;
the table leaves that out.

| Command | Files written | Processes started | Network |
| --- | --- | --- | --- |
| `scan`, `flow` | none; the report goes to stdout, or to `--out` | `git`, to stamp the report with the commit it read | none |
| `inventory` | none; `--out` for the report | none | none |
| `parse` | none | none | none |
| `tui` | none | none | none |
| `explain` | none | none | none |
| `capabilities` | none | `git`, to stamp the commit cobolwork runs from | none |
| `sbom` | `--out` | `git`, to stamp the commit | none |
| `diff` | `--out`; a temporary directory holding the compared revisions, removed afterwards | `git` | none |
| `baseline` | `cobolwork.baseline.json` in the tree, or `--out` | none | none |
| `gate` | `--out`; a temporary directory as for `diff` | `git`; `cobc` (`--cobc`, or the first on `PATH` outside the repository) to syntax-check the patch | none |
| `build` | `--out`, `--provenance`; a temporary directory as for `diff`; with `--precompile`, a temporary directory per translated program, removed after the check | `git`; the compiler named after `--` (or `cobc`), only on a pass, and with `--precompile` first with `-fsyntax-only` on each translation; `ironwork` with `--ironwork` | none from cobolwork; the compiler's own |
| `evidence verify` | none | `git` against `--anchor-git`; `openssl` with `--tsr`; `cosign` with `--cosign-bundle` | `cosign` contacts the transparency log unless `--insecure-ignore-tlog` is given |
| `evidence seal` | a seal in the evidence directory | `ssh-keygen` with `--ssh-key`, or the program named by `--signer` | none from cobolwork; the signer's own |
| `evidence anchor` | the seal copied into the `--anchor-git` repository and committed there; `--tsq` and a kept copy beside the seal | `git` | `git push` to the anchor repository's remote with `--push` |
| `evidence sign` | `--out` | `ssh-keygen` or the `--signer` program | none from cobolwork; the signer's own |

`--out` writes a file only where it is given. The scan commands read the tree, the copy libraries
named by `--copylib`, and the files named by `--baseline`, `--advisories` and `--policy`.

## What does not count

- **A missed finding.** Recall is a measured property, not a vulnerability. Open an issue with the
  program that was not flagged; it is wanted, and it is how the benchmark grows.
- **A false positive.** Same: open an issue. Precision is measured, published, and improved in the
  open.
- **Findings cobolwork reports about your code.** Those are yours to fix, not ours to receive.

## Scope

This repository: the CLI, the library, and `rules/gitleaks-mainframe.toml`. Vulnerabilities in
GnuCOBOL, gitleaks or Node.js belong with those projects.
