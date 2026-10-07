// Computes the coverage banner lines and completeness flag for a report summary (lib/tui/model.mjs banner).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { banner } from '../lib/tui/model.mjs';
import './pin-machine.mjs';

test('returns incomplete with a single message when nosrc is true', () => {
  const report = { summary: { nosrc: true } };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: false,
    lines: ['COVERAGE: nothing was read - no COBOL, JCL or copybook was found']
  });
});

test('returns complete with file count and no sets when coverage is complete and no sets incomplete', () => {
  const report = { summary: { filesScanned: 42 } };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: true,
    lines: ['Coverage complete: every file was read (42)']
  });
});

test('returns complete with file count and one configuration set line', () => {
  const report = {
    summary: {
      filesScanned: 10,
      setsIncomplete: [{ set: 'jcl', kind: 'configuration', why: 'no JCL found' }]
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: true,
    lines: [
      'Coverage complete: every file was read (10)',
      'jcl      not run: no JCL found'
    ]
  });
});

test('returns complete with file count and one non-configuration set line', () => {
  const report = {
    summary: {
      filesScanned: 5,
      setsIncomplete: [{ set: 'copy', kind: 'source', why: 'missing copybooks' }]
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: true,
    lines: [
      'Coverage complete: every file was read (5)',
      'copy     missing copybooks'
    ]
  });
});

test('returns incomplete with header and sets when coverageIncomplete is true and no missing items', () => {
  const report = {
    summary: {
      coverageIncomplete: true,
      setsIncomplete: [
        { set: 'jcl', kind: 'configuration', why: 'no JCL' },
        { set: 'copy', kind: 'source', why: 'no copies' }
      ]
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: false,
    lines: [
      'COVERAGE INCOMPLETE - read this before the counts',
      'jcl      not run: no JCL',
      'copy     no copies'
    ]
  });
});

test('returns incomplete with copiesMissing line when copies are missing', () => {
  const report = {
    summary: {
      coverageIncomplete: true,
      copiesMissing: 3
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: false,
    lines: [
      'COVERAGE INCOMPLETE - read this before the counts',
      'copy     3 COPY statement(s) name a copybook that is not in the tree'
    ]
  });
});

test('returns incomplete with filesUnreadable line when files are unreadable', () => {
  const report = {
    summary: {
      coverageIncomplete: true,
      filesUnreadable: 2
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: false,
    lines: [
      'COVERAGE INCOMPLETE - read this before the counts',
      'files    2 file(s) could not be read'
    ]
  });
});

test('returns incomplete with filesOverBudget line when files are over budget', () => {
  const report = {
    summary: {
      coverageIncomplete: true,
      filesOverBudget: 1
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: false,
    lines: [
      'COVERAGE INCOMPLETE - read this before the counts',
      'budget   1 file(s) were past the source budget'
    ]
  });
});

test('returns incomplete with all three missing item lines when all are present', () => {
  const report = {
    summary: {
      coverageIncomplete: true,
      copiesMissing: 5,
      filesUnreadable: 2,
      filesOverBudget: 3
    }
  };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: false,
    lines: [
      'COVERAGE INCOMPLETE - read this before the counts',
      'copy     5 COPY statement(s) name a copybook that is not in the tree',
      'files    2 file(s) could not be read',
      'budget   3 file(s) were past the source budget'
    ]
  });
});

test('returns complete with question mark when filesScanned is undefined', () => {
  const report = { summary: {} };
  const result = banner(report);
  assert.deepEqual(result, {
    complete: true,
    lines: ['Coverage complete: every file was read (?)']
  });
});
