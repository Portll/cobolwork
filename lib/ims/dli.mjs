// SPDX-License-Identifier: AGPL-3.0-or-later
// The DL/I call interface as a program issues it: CALL 'CBLTDLI' or 'AIBTDLI' USING [count,] function,
// PCB or AIB, I/O area [, SSA ...], and EXEC DLI. Each database function needs a processing option on
// the PCB it runs against, the PROCOPT of its PSBGEN PCB or SENSEG: a get needs G, ISRT I, REPL R
// and DLET D. A get call fills the I/O area with the segment it retrieves.

export const DLI_ROUTINE = /^(CBLTDLI|AIBTDLI)$/i;

export const DLI_FUNCTIONS = Object.freeze({
  GU: 'G', GN: 'G', GNP: 'G', GHU: 'G', GHN: 'G', GHNP: 'G',
  ISRT: 'I', REPL: 'R', DLET: 'D',
});

export const isGet = (fn) => DLI_FUNCTIONS[fn] === 'G';

// Calls that are not database calls: scheduling, termination, checkpoint, restart, rollback, sync,
// logging, statistics and the system service calls. They need no processing option.
export const DLI_SERVICES = new Set(['PCB', 'TERM', 'CHKP', 'XRST', 'ROLB', 'ROLL', 'ROLS', 'SETS', 'SETU', 'SYNC', 'INIT',
  'INQY', 'GSCD', 'LOG', 'STAT', 'APSB', 'DPSB', 'GMSG', 'ICMD', 'RCMD', 'SCHD', 'AUTH', 'CHNG', 'PURG', 'CMD', 'GCMD', 'ICAL']);

// The PSB a DFSRRC00 step's PARM names: region type, program, then PSB, which defaults to the program.
export function psbOfParm(parm) {
  const [, program, psb] = String(parm || '').replace(/^[('\s]+|[)'\s]+$/g, '').split(',').map((x) => x.trim().toUpperCase());
  return program ? { program, psb: psb || program } : null;
}

// The function code of a CALL to a DL/I routine and the argument that holds it: the first argument,
// or the second when the first is a parameter count. `valueOf(arg)` gives the literal or the VALUE
// of the item an argument names.
export function dliFunction(using, valueOf) {
  for (let index = 0; index < Math.min(2, using.length); index++) {
    const v = valueOf(using[index]);
    const fn = v == null ? null : String(v).trim().toUpperCase();
    if (fn && Object.hasOwn(DLI_FUNCTIONS, fn)) return { fn, index };
  }
  return null;
}
