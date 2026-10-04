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
// manifest and the main-program manifests (counts, and where given the roots and the statements
// their runs started, named from a root as ironwork names them), laid out as the corpus runner
// lays them out.
function run({ findings, rows, interfaces, mains = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-label-interface-'));
  writeFileSync(join(dir, 'scan-results.json'), JSON.stringify([{ repo: 'R', findings }]));
  writeFileSync(join(dir, 'fuzz-results.jsonl'), rows.map((r) => JSON.stringify({ repo: 'R', ...r })).join('\n'));
  for (const [program, manifest] of Object.entries(interfaces)) {
    const at = join(dir, 'R', `${program.replace(/[\\/]/g, '__')}.interface`);
    mkdirSync(at, { recursive: true });
    writeFileSync(join(at, 'manifest.json'), JSON.stringify({ program: { file: program, ...manifest.program }, callers: manifest.callers }));
  }
  for (const [program, { counts, roots, statements }] of Object.entries(mains)) {
    const at = join(dir, 'R', program.replace(/[\\/]/g, '__'));
    mkdirSync(join(at, 'coverage'), { recursive: true });
    const runCoverage = statements ? 'coverage/runs.json' : undefined;
    if (statements) writeFileSync(join(at, runCoverage), JSON.stringify({ runs: counts.runs, statements, paragraphs: [] }));
    writeFileSync(join(at, 'manifest.json'), JSON.stringify({ program: { file: program }, roots, counts, runCoverage }));
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

test('an unconfirmed interface finding says why: no CALL, a PROGRAM-ID -L cannot find, callers not fuzzed or refused, callers whose runs never reached the CALL, or a caller that ran elsewhere', () => {
  const dir = run({
    findings: [
      finding('src/ALONE.cbl', 5, 'interface'),
      finding('src/data.cob', 9, 'interface'),
      finding('src/IDLE.cbl', 3, 'interface'),
      finding('src/RAN.cbl', 4, 'interface'),
      finding('src/BARRED.cbl', 6, 'interface'),
      finding('src/REACHED.cbl', 7, 'interface'),
      finding('src/MISSED.cbl', 8, 'interface'),
      finding('src/INNER.cbl', 9, 'interface'),
      finding('copy/MEMBER.cpy', 2, 'interface'),
    ],
    rows: ['src/CALLER.cbl', 'src/REFUSER.cbl', 'src/COVERED.cbl', 'src/BYPASS.cbl', 'src/MIDDLE.cbl']
      .map((program) => ({ program }))
      .concat({ program: 'src/IDLER.cbl', skipped: 'probe wrote no manifest' }),
    interfaces: {
      'src/ALONE.cbl': subprogram('ALONE', []),
      'src/data.cob': subprogram('DATAPROGRAM', [{ file: 'src/CALLER.cbl', line: 8 }]),
      'src/IDLE.cbl': subprogram('IDLE', [{ file: 'src/IDLER.cbl', line: 6 }, { file: 'src/GONE.cbl', line: 2 }]),
      'src/RAN.cbl': subprogram('RAN', [{ file: 'src/CALLER.cbl', line: 9 }]),
      'src/BARRED.cbl': subprogram('BARRED', [{ file: 'src/REFUSER.cbl', line: 5 }]),
      'src/REACHED.cbl': subprogram('REACHED', [{ file: 'src/BYPASS.cbl', line: 20 }, { file: 'src/COVERED.cbl', line: 11 }]),
      'src/MISSED.cbl': subprogram('MISSED', [{ file: 'src/BYPASS.cbl', line: 21 }, { file: 'src/REFUSER.cbl', line: 6 }]),
      'src/INNER.cbl': subprogram('INNER', [{ file: 'src/MIDDLE.cbl', line: 30 }]),
    },
    mains: {
      'src/CALLER.cbl': { counts: { runs: 100, refused: 3 } },
      'src/REFUSER.cbl': { counts: { runs: 100, refused: 100 } },
      'src/COVERED.cbl': { counts: { runs: 100, refused: 0 }, roots: ['src', 'copy'], statements: [{ file: 'COVERED.cbl', line: 11, runs: 4, started: 9 }] },
      'src/BYPASS.cbl': {
        counts: { runs: 100, refused: 0 },
        roots: ['src'],
        statements: [{ file: 'BYPASS.cbl', line: 19, runs: 100, started: 100 }, { file: 'BYPASS.cbl', line: 21, runs: 0, started: 0 }, { file: 'OTHER.cbl', line: 20, runs: 9, started: 9 }],
      },
    },
  });
  const why = Object.fromEntries(labelInterface(dir).labels.map((l) => [l.path, [l.label, l.why]]));
  assert.deepEqual(why, {
    'src/ALONE.cbl': ['unknown', 'no program ironwork compiles CALLs it'],
    'src/data.cob': ['unknown', 'its callers CALL DATAPROGRAM, which -L does not find in data.cob'],
    'src/IDLE.cbl': ['unknown', 'no caller ran: not fuzzed: probe wrote no manifest; no fuzz run of it'],
    'src/RAN.cbl': ['unknown', 'a caller ran and did not end there'],
    'src/BARRED.cbl': ['unknown', 'no caller ran: every run of it refused'],
    'src/REACHED.cbl': ['unknown', 'a caller ran the CALL and did not end there'],
    'src/MISSED.cbl': ['unknown', 'no caller run reached the CALL'],
    'src/INNER.cbl': ['unknown', 'no caller ran: not fuzzed as a main program'],
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
