# The GitHub Action

`action.yml` at the root of this repository is a composite action that runs `cobolwork build`
(see [the build gate](spec/build-gate.md)) over a checkout and writes the result as SARIF. It does
not upload the SARIF itself; the workflow that calls it does, so the upload permission stays with
the workflow and the upload still happens when the gate fails.

## What it does

1. Installs Node 22.
2. Installs `@portll/cobolwork` from npm at the requested version, or uses the copy in the
   action's own checkout when `version` is `local`.
3. Runs `cobolwork build <path> --format sarif --out <sarif>`, adding `--base`, `--policy` and
   `--copylib` when they are given.
4. Copies the gate's one-line summary from standard error to the job log and to the job summary.
5. Sets the outputs, then exits according to the exit status and `fail-on`.

With a `base`, the gate runs in ratchet mode: it judges what the change introduced, against that
revision. With no `base` it judges the tree as it stands (absolute mode). On a `pull_request` event
`base` defaults to the pull request's base commit; on any other event it is empty, so a push to
`main` is judged in absolute mode.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `path` | `.` | Repository directory to judge, relative to the workspace. |
| `base` | the pull request base SHA, else empty | Revision to measure the change against. Empty means absolute mode. |
| `policy` | none | An organisation policy file, from outside the repository being judged. |
| `copylib` | none | Directories of system copybooks the source includes, comma-separated. |
| `version` | `latest` | npm version or tag of `@portll/cobolwork`, or `local` for the action's own checkout. |
| `sarif` | `cobolwork.sarif` | Where the SARIF file is written, relative to the workspace. |
| `fail-on` | `fail` | `fail`: exit 1, 2 and 4 fail the step. `undecided`: exit 3 fails it as well. |

## Outputs

| Output | Meaning |
|---|---|
| `verdict` | The verdict on the gate's summary line (`pass`, `fail`, `undecided`), or `error` when it did not run. |
| `exit-code` | The exit status of `cobolwork build`. |
| `sarif` | The path the SARIF file was written to. |

## Example

```yaml
name: cobolwork
on:
  pull_request:
  push:
    branches: [main]

permissions: {}

jobs:
  gate:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      security-events: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - id: gate
        uses: Portll/cobolwork@main
        with:
          policy: ${{ runner.temp }}/policy.json
      - uses: github/codeql-action/upload-sarif@2892aa5e19bbd11bc0cff5427e3b750a04d9e3c2 # v4.38.2
        if: always()
        with:
          sarif_file: ${{ steps.gate.outputs.sarif }}
```

Pin `Portll/cobolwork` to a full commit SHA as well in a repository that pins the rest of its
workflow.

[Portll/cobolwork-action-test](https://github.com/Portll/cobolwork-action-test) runs this workflow
on GitHub-hosted runners, without the policy, and a second that checks how the step ends at each
exit status.

`fetch-depth: 0` is needed for ratchet mode: the base commit has to be in the checkout, and the
default shallow checkout of a pull request does not contain it. Without it the gate cannot resolve
`base` and exits 2.

`if: always()` on the upload step is what puts the findings in code scanning when the gate fails,
which is the case they matter in. If the gate exits 2 before writing a file, the upload step fails
for want of one; that failure is secondary to the gate's own.

The `policy` file must lie outside the repository being judged. In a workflow that means a second
checkout of the repository that holds it, into a directory outside the workspace's `path`. The
repository's own `cobolwork.policy.json` is read as well, from the base revision in ratchet mode,
and the stricter of the two applies at every key.

## Exit codes

| Exit | Meaning | Fails the step |
|---|---|---|
| 0 | pass, and any compiler the gate was given exited 0 | no |
| 1 | fail: a check failed | yes |
| 2 | could not run: not a repository, a revision that does not resolve, a policy that does not validate | yes |
| 3 | undecided: no check failed and at least one could not be decided | only with `fail-on: undecided` |
| 4 | pass, and the compiler exited non-zero | yes |

The action passes no compiler, so exit 4 does not arise from it. It is handled the same as 1 in case
a later version of the action does.

## The SARIF

The file is the scan's SARIF with each finding that blocks the build at level `error` and every
other finding at `warning` or `note`. Code scanning therefore shows what stopped the build as an
error and the remaining debt as advisory.

Code scanning keeps one severity per alert, from the latest upload that reported it. A finding that
blocks `main` in absolute mode is debt in a pull request's ratchet, so that pull request's upload
shows the `main` alert as a warning until `main` is scanned again. Its security severity, which the
rule carries, does not change.
