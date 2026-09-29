// SPDX-License-Identifier: AGPL-3.0-or-later
// Builds the PyPI package: the files npm ships, behind a Python launcher that runs them with Node.
//   node packaging/pypi/build.mjs <outdir>
import { cpSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = resolve(process.argv[2] || 'dist');
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

const work = mkdtempSync(join(tmpdir(), 'cobolwork-pypi-'));
run('npm', ['pack', '--pack-destination', work], root);
const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
run('tar', ['-xzf', join(work, tarball), '-C', work], root);

const stage = join(work, 'stage');
cpSync(join(root, 'packaging', 'pypi', 'cobolwork'), join(stage, 'cobolwork'), { recursive: true });
cpSync(join(work, 'package'), join(stage, 'cobolwork', 'node'), { recursive: true });
for (const f of ['README.md', 'LICENSE', 'NOTICE', 'LICENSING.md', 'THIRD-PARTY-NOTICES.md']) cpSync(join(root, f), join(stage, f));

const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const pyproject = readFileSync(join(root, 'packaging', 'pypi', 'pyproject.toml'), 'utf8');
if (!pyproject.includes('version = "0.0.0"')) throw new Error('pyproject.toml has no version placeholder');
writeFileSync(join(stage, 'pyproject.toml'), pyproject.replace('version = "0.0.0"', `version = "${version}"`));

run(process.env.PYTHON || 'python3', ['-m', 'build', '--outdir', out, stage], root);
