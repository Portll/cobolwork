// compileStepOptions: PARM and SYSIN attribution for direct and procedure-based COBOL compile steps (lib/options.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileStepOptions } from '../lib/options.mjs';
import './pin-machine.mjs';

test('returns empty array when parsed is empty', () => {
  assert.deepEqual(compileStepOptions([]), []);
});

test('extracts member and options from direct IGYCRCTL step with SYSIN', () => {
  const parsed = [{
    file: 'JCL1',
    steps: [{
      pgm: 'IGYCRCTL',
      inProc: false,
      line: 10,
      parm: 'NOZLEN,ABD',
      dds: [{ name: 'SYSIN', dsn: 'LIB(MEMBER1)' }]
    }]
  }];
  assert.deepEqual(compileStepOptions(parsed), [
    { member: 'MEMBER1', options: ['NOZLEN', 'ABD'], file: 'JCL1', line: 10 }
  ]);
});

test('skips direct IGYCRCTL step when SYSIN member is symbolic', () => {
  const parsed = [{
    file: 'JCL1',
    steps: [{
      pgm: 'IGYCRCTL',
      inProc: false,
      line: 10,
      parm: 'NOZLEN',
      dds: [{ name: 'SYSIN', dsn: 'LIB(&MEMBER)' }]
    }]
  }];
  assert.deepEqual(compileStepOptions(parsed), []);
});

test('skips direct IGYCRCTL step when no SYSIN dd is present', () => {
  const parsed = [{
    file: 'JCL1',
    steps: [{
      pgm: 'IGYCRCTL',
      inProc: false,
      line: 10,
      parm: 'NOZLEN',
      dds: []
    }]
  }];
  assert.deepEqual(compileStepOptions(parsed), []);
});

test('uses procedure compile step PARM when caller gives none', () => {
  const parsed = [
    {
      file: 'PROC',
      procs: [{
        name: 'MYPROC',
        steps: [
          { name: 'STEP1', pgm: 'OTHER' },
          { name: 'COMPILE', pgm: 'IGYCRCTL', parm: 'NOZLEN,ABD', dds: [{ name: 'SYSIN', dsn: 'LIB(&MEMBER)' }] }
        ]
      }]
    },
    {
      file: 'JCL1',
      steps: [{
        proc: 'MYPROC',
        line: 20,
        keywords: new Map([['MEMBER', 'MEMBER1']]),
        dds: []
      }]
    }
  ];
  assert.deepEqual(compileStepOptions(parsed), [
    { member: 'MEMBER1', options: ['NOZLEN', 'ABD'], file: 'JCL1', line: 20 }
  ]);
});

test('prefers caller PARM.<step> over procedure PARM', () => {
  const parsed = [
    {
      file: 'PROC',
      procs: [{
        name: 'MYPROC',
        steps: [
          { name: 'COMPILE', pgm: 'IGYCRCTL', parm: 'PROC_OPT', dds: [{ name: 'SYSIN', dsn: 'LIB(&MEMBER)' }] }
        ]
      }]
    },
    {
      file: 'JCL1',
      steps: [{
        proc: 'MYPROC',
        line: 20,
        keywords: new Map([
          ['MEMBER', 'MEMBER1'],
          ['PARM.COMPILE', 'CALLER_OPT']
        ]),
        dds: []
      }]
    }
  ];
  assert.deepEqual(compileStepOptions(parsed), [
    { member: 'MEMBER1', options: ['CALLER_OPT'], file: 'JCL1', line: 20 }
  ]);
});

test('uses unqualified PARM when compile step is first in procedure', () => {
  const parsed = [
    {
      file: 'PROC',
      procs: [{
        name: 'MYPROC',
        steps: [
          { name: 'COMPILE', pgm: 'IGYCRCTL', parm: 'PROC_OPT', dds: [{ name: 'SYSIN', dsn: 'LIB(&MEMBER)' }] }
        ]
      }]
    },
    {
      file: 'JCL1',
      steps: [{
        proc: 'MYPROC',
        line: 20,
        keywords: new Map([
          ['MEMBER', 'MEMBER1'],
          ['PARM', 'UNQUAL_OPT']
        ]),
        dds: []
      }]
    }
  ];
  assert.deepEqual(compileStepOptions(parsed), [
    { member: 'MEMBER1', options: ['UNQUAL_OPT'], file: 'JCL1', line: 20 }
  ]);
});

test('ignores unqualified PARM when compile step is not first in procedure', () => {
  const parsed = [
    {
      file: 'PROC',
      procs: [{
        name: 'MYPROC',
        steps: [
          { name: 'STEP1', pgm: 'OTHER' },
          { name: 'COMPILE', pgm: 'IGYCRCTL', parm: 'PROC_OPT', dds: [{ name: 'SYSIN', dsn: 'LIB(&MEMBER)' }] }
        ]
      }]
    },
    {
      file: 'JCL1',
      steps: [{
        proc: 'MYPROC',
        line: 20,
        keywords: new Map([
          ['MEMBER', 'MEMBER1'],
          ['PARM', 'UNQUAL_OPT']
        ]),
        dds: []
      }]
    }
  ];
  assert.deepEqual(compileStepOptions(parsed), [
    { member: 'MEMBER1', options: ['PROC_OPT'], file: 'JCL1', line: 20 }
  ]);
});

test('uses IBM compile procedure COBOL step with caller SYSIN', () => {
  const parsed = [
    {
      file: 'JCL1',
      steps: [{
        proc: 'IGYWCP',
        line: 30,
        keywords: new Map(),
        dds: [{ name: 'COBOL.SYSIN', dsn: 'LIB(MEMBER2)' }]
      }]
    }
  ];
  assert.deepEqual(compileStepOptions(parsed), [
    { member: 'MEMBER2', options: [], file: 'JCL1', line: 30 }
  ]);
});

test('skips step when no member can be attributed', () => {
  const parsed = [
    {
      file: 'PROC',
      procs: [{
        name: 'MYPROC',
        steps: [
          { name: 'COMPILE', pgm: 'IGYCRCTL', parm: 'OPT', dds: [{ name: 'SYSIN', dsn: 'LIB(&MEMBER)' }] }
        ]
      }]
    },
    {
      file: 'JCL1',
      steps: [{
        proc: 'MYPROC',
        line: 20,
        keywords: new Map(),
        dds: []
      }]
    }
  ];
  assert.deepEqual(compileStepOptions(parsed), []);
});
