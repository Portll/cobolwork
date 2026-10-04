// Interface labels from a corpus run: a subprogram's interface finding is confirmed where a caller's
// main-program run ends at the same rule, file and line, and unknown with its reason otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { labelInterface, SOURCE } from '../bench/label-interface.mjs';
import { precision } from '../bench/precision.mjs';
import './pin-machine.mjs';

const S0C7 = 'input-causes-abend-s0c7';

// A run directory holding one repository's scan, a row per program, each subprogram's interface
// manifest and the main-program manifests' counts, laid out as the corpus runner lays them out.
function run({ findings, rows, interfaces, mains = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-label-interface-'));
  writeFileSync(join(dir, 'scan-results.json'), JSON.stringify([{ repo: 'R', findings }]));
  writeFileSync(join(dir, 'fuzz-results.jsonl'), rows.map((r) => JSON.stringify({ repo: 'R', ...r })).join('\n'));
  for (const [program, manifest] of Object.entries(interfaces)) {
    const at = join(dir, 'R', `${program.replace(/[\\/]/g, '__')}.interface`);
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'manifest.json'), JSON.stringify({ program: { file: program, ...manifest.program }, callers: manifest.callers }));
  }
  for (const [program, counts] of Object.entries(mains)) {
    const at = join(dir, 'R', program.replace(/[\\/]/g, '__'));
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'manifest.json'), JSON.stringify({ program: { file: program }, counts }));
  }
  return dir;
}

const finding = (path, line, inputFrom) => ({ rule: S0C7, path, line, inputFrom });
const subprogram = (id, callers) => ({ program: { id }, callers });

test('a caller that ends at the same place confirms the interface finding', () => {
  const dir = run({
    findings: [finding('src/ADDQTY.cbl', 14, 'interface'), finding('src/ADDQTY.cbl', 14, 'entry')],
    rows: [{ program: 'src/ADDQTY.cbl', skipped: 'probe wrote no manifest' }, { program: 'src/MAINP.cbl' }],
    interfaces: { 'src/ADDQTY.cbl': subprogram('ADDQTY', [{ file: 'src/MAINP.cbl', line: 7 }]) },
  });
  const doc = labelInterface(dir);
  assert.deepEqual(doc.labels, [{ source: SOURCE, rule: S0C7, repo: 'R', path: 'src/ADDQTY.cbl', line: 14, label: 'confirmed' }]);
  assert.equal(doc.counts.confirmed, 1);
});

test('an unconfirmed interface finding says why: no CALL, a PROGRAM-ID -L cannot find, callers not fuzzed or refused, or a caller that ran elsewhere', () => {
  const dir = run({
    findings: [
      finding('src/ALONE.cbl', 5, 'interface'),
      finding('src/data.cob', 9, 'interface'),
      finding('src/IDLE.cbl', 3, 'interface'),
      finding('src/RAN.cbl', 4, 'interface'),
      finding('src/BARRED.cbl', 6, 'interface'),
      finding('copy/MEMBER.cpy', 2, 'interface'),
    ],
    rows: [{ program: 'src/IDLER.cbl', skipped: 'probe wrote no manifest' }, { program: 'src/CALLER.cbl' }, { program: 'src/REFUSER.cbl' }],
    interfaces: {
      'src/ALONE.cbl': subprogram('ALONE', []),
      'src/data.cob': subprogram('DATAPROGRAM', [{ file: 'src/CALLER.cbl', line: 8 }]),
      'src/IDLE.cbl': subprogram('IDLE', [{ file: 'src/IDLER.cbl', line: 6 }, { file: 'src/GONE.cbl', line: 2 }]),
      'src/RAN.cbl': subprogram('RAN', [{ file: 'src/CALLER.cbl', line: 9 }]),
      'src/BARRED.cbl': subprogram('BARRED', [{ file: 'src/REFUSER.cbl', line: 5 }]),
    },
    mains: { 'src/CALLER.cbl': { runs: 100, refused: 3 }, 'src/REFUSER.cbl': { runs: 100, refused: 100 } },
  });
  const why = Object.fromEntries(labelInterface(dir).labels.map((l) => [l.path, [l.label, l.why]]));
  assert.deepEqual(why, {
    'src/ALONE.cbl': ['unknown', 'no program ironwork compiles CALLs it'],
    'src/data.cob': ['unknown', 'its callers CALL DATAPROGRAM, which -L does not find in data.cob'],
    'src/IDLE.cbl': ['unknown', 'no caller ran: not fuzzed: probe wrote no manifest; no fuzz run of it'],
    'src/RAN.cbl': ['unknown', 'a caller ran and did not end there'],
    'src/BARRED.cbl': ['unknown', 'no caller ran: every run of it refused'],
    'copy/MEMBER.cpy': ['unknown', 'the abend is not in the fuzzed subprogram\'s own source'],
  });
});

test('interface labels are their own source, whose low precision is the share callers confirmed', () => {
  const dir = run({
    findings: [finding('src/A.cbl', 1, 'interface'), finding('src/A.cbl', 1, 'entry'), finding('src/B.cbl', 2, 'interface')],
    rows: [{ program: 'src/MAINP.cbl' }],
    interfaces: { 'src/A.cbl': subprogram('A', [{ file: 'src/MAINP.cbl', line: 3 }]), 'src/B.cbl': subprogram('B', [{ file: 'src/MAINP.cbl', line: 4 }]) },
  });
  const file = join(dir, 'labels.json');
  writeFileSync(file, JSON.stringify(labelInterface(dir)));
  const row = precision([file]).byRule[S0C7];
  assert.deepEqual(Object.keys(row), [SOURCE]);
  assert.deepEqual(row[SOURCE].precision, { low: 0.5, high: 1 });
});
