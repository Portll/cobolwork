// diag/drive-manifest.mjs over a volume made in a temporary directory, with a manifest written for it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkManifest, manifestLine } from '../diag/drive-manifest.mjs';
import './pin-machine.mjs';

function onVolume(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-drive-'));
  const volume = join(dir, 'volume');
  const put = (rel, text) => { mkdirSync(join(volume, rel, '..'), { recursive: true }); writeFileSync(join(volume, rel), text); };
  put('corpus/repo/SAME.cbl', 'same');
  put('corpus/repo/GROWN.cbl', 'grown since');
  put('corpus/repo/NEW.cbl', 'new');
  put('corpus/other/KEPT.cbl', 'kept');
  put('elsewhere/NOT-MEASURED.cbl', 'x');
  const manifest = join(dir, 'manifest.tsv');
  writeFileSync(manifest, [
    'D\tcorpus', 'D\tcorpus/repo', 'D\tcorpus/other', 'D\telsewhere',
    'F\tcorpus/repo/SAME.cbl\t4\t0', 'F\tcorpus/repo/GROWN.cbl\t5\t0', 'F\tcorpus/repo/GONE.cbl\t9\t0',
    'F\tcorpus/other/KEPT.cbl\t4\t0', 'F\tcorpus/dropped/A.cbl\t1\t0', 'F\telsewhere/NOT-MEASURED.cbl\t7\t0',
    'F\tcorpusB/B.cbl\t1\t0', '',
  ].join('\n'));
  try { return fn({ dir, volume, manifest }); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('counts the files the manifest lists under the corpus root against what is on disk, by path and size', () => onVolume(({ volume, manifest }) => {
  const m = checkManifest(join(volume, 'corpus'), { manifest, volume });
  assert.deepEqual(m, {
    file: manifest, under: 'corpus', files: 5, matched: 2, missing: 2, sizeDiffers: 1, notInManifest: 1, dirsUnlisted: 0, agrees: false,
    first: { missing: ['dropped/A.cbl', 'repo/GONE.cbl'], sizeDiffers: ['repo/GROWN.cbl'], notInManifest: ['repo/NEW.cbl'] },
  });
  assert.equal(manifestLine(m), 'drive manifest: of the 5 files it lists under corpus, 2 are on disk at its size, 2 missing, 1 of another size; '
    + '1 on disk are not in it; the first missing dropped/A.cbl, of another size repo/GROWN.cbl, not in it repo/NEW.cbl');

  const agreed = checkManifest(join(volume, 'corpus', 'other'), { manifest, volume });
  assert.equal(agreed.agrees, true);
  assert.equal(agreed.first, undefined);
}));

test('a directory the walk cannot list is counted, and its files are missing', { skip: process.platform === 'win32' && 'mode bits do not stop a listing on Windows' }, () => onVolume(({ volume, manifest }) => {
  const locked = join(volume, 'corpus', 'other');
  chmodSync(locked, 0o000);
  try {
    const m = checkManifest(join(volume, 'corpus'), { manifest, volume });
    assert.equal(m.dirsUnlisted, 1);
    assert.deepEqual(m.first.dirsUnlisted, ['other']);
    assert.ok(m.first.missing.includes('other/KEPT.cbl'));
    assert.match(manifestLine(m), /; 1 directory could not be listed; the first missing dropped\/A\.cbl, .*, not listed other$/);
  } finally { chmodSync(locked, 0o755); }
}));

test('is skipped, with the reason, off the volume or without a manifest; the environment names both', () => onVolume(({ dir, volume, manifest }) => {
  assert.deepEqual(checkManifest(tmpdir(), { manifest, volume }), { skipped: `the corpus root is not on ${volume}` });
  const absent = join(dir, 'absent.tsv');
  assert.deepEqual(checkManifest(join(volume, 'corpus'), { manifest: absent, volume }), { skipped: `no manifest at ${absent} (ENOENT)` });
  assert.equal(manifestLine({ skipped: 'why' }), 'drive manifest not checked: why');
  const saved = [process.env.COBOLWORK_MANIFEST, process.env.COBOLWORK_MANIFEST_ROOT];
  process.env.COBOLWORK_MANIFEST = manifest;
  process.env.COBOLWORK_MANIFEST_ROOT = volume;
  try {
    assert.equal(checkManifest(join(volume, 'corpus', 'other')).agrees, true);
  } finally {
    for (const [k, v] of [['COBOLWORK_MANIFEST', saved[0]], ['COBOLWORK_MANIFEST_ROOT', saved[1]]]) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}));
