// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import './pin-machine.mjs';

const TOOL = fileURLToPath(new URL('../diag/hlasm-corpus.mjs', import.meta.url));
const PROGRAM = `PROG     CSECT
         USING PROG,12
         STM   14,12,12(13)
         LR    12,15
         LA    1,AREA
         BR    14
AREA     DS    CL80
         END   PROG
`;

function corpus(root, repos) {
  for (const [repo, files] of Object.entries(repos)) {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(root, repo, path, '..'), { recursive: true });
      writeFileSync(join(root, repo, path), text);
    }
  }
  return root;
}

test('a file already kept by the dev split is not kept again by the held-out split', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'hlasm-corpus-'));
  try {
    const dev = corpus(join(tmp, 'devset'), { one: { 'src/prog.asm': PROGRAM, 'src/rec.cpy': '       01 REC PIC X.\n' } });
    const heldout = corpus(join(tmp, 'heldset'), {
      two: { 'copy.asm': PROGRAM },
      three: { 'other.asm': PROGRAM.replaceAll('PROG', 'OTHR') },
    });
    const out = join(tmp, 'out');
    execFileSync(process.execPath, [TOOL, out, '--dev', dev, '--heldout', heldout], { env: { ...process.env, CW_NOW: '2026-01-01T00:00:00.000Z' } });
    const manifest = JSON.parse(readFileSync(join(out, 'manifest.json'), 'utf8'));
    assert.deepEqual(manifest, {
      built: '2026-01-01T00:00:00.000Z',
      dedup: 'sha256, dev first',
      dev: { one: { corpus: 'devset', files: 1, members: 2 } },
      heldout: { three: { corpus: 'heldset', files: 1, members: 1 } },
    });
    assert.ok(existsSync(join(out, 'dev/one/src/prog.asm')));
    assert.ok(existsSync(join(out, 'members/one/REC.cpy')));
    assert.ok(!existsSync(join(out, 'heldout/two')));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('no corpus named is a usage error', () => {
  assert.throws(() => execFileSync(process.execPath, [TOOL, join(tmpdir(), 'unused')], { stdio: 'pipe' }), (e) => e.status === 2);
});
