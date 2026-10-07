// SPDX-License-Identifier: AGPL-3.0-or-later
// Operands the MVS 3.8 system macros take that z/OS 3.1's documentation does not list, with the
// meaning those macros give them (MVS 3.8j SYS1.MACLIB, public domain: MODESET, GETMAIN, FREEMAIN,
// ATTACH, DCB). Read by default; parseHlasmStatement(st, { mvs38: false }) refuses them.
import { HlasmSyntax } from './operands.mjs';

// MODESET EXTKEY= names and the PSW key each sets.
export const MVS38_EXTKEYS = new Map([
  ['SUPR', 0], ['RSM', 0], ['VSM', 0], ['SRM', 0],
  ['SCHED', 1], ['JES', 1], ['HASP', 1],
  ['DATAMGT', 5],
  ['TCAM', 6], ['VTAM', 6],
]);

// GETMAIN and FREEMAIN P: a request for a subpool, register 0 holding its number in the high byte.
export const MVS38_STORAGE_MODES = new Set(['P']);

// HIARCHY= chose a storage hierarchy (0 or 1); MVS/XA removed hierarchies.
export const MVS38_HIARCHY = /^[01]$/;

export const MVS38_KEYWORDS = {
  GETMAIN: new Set(['HIARCHY']),
  ATTACH: new Set(['HIARCHY', 'JSCB']),
  DCB: new Set(['PGFX', 'AERR']),
};

export const mvs38Enabled = (opts) => opts?.mvs38 !== false;

export const systemKeyExtkeys = (opts) => (mvs38Enabled(opts) ? [...MVS38_EXTKEYS].filter(([, key]) => key > 0) : []);

export const keyZeroExtkeys = (opts) => (mvs38Enabled(opts) ? [...MVS38_EXTKEYS].filter(([, key]) => key === 0).map(([name]) => name) : []);

// Marks an MVS 3.8 form on the node it is read into, or refuses it when the option is off.
export function mvs38Form(opts, node, macro, form) {
  if (!mvs38Enabled(opts)) throw new HlasmSyntax(`${macro}: ${form} is an MVS 3.8 form`);
  (node.mvs38 ||= []).push(form);
}

// BTAM's READ and WRITE types (IHBRDWRT); BTAM is not in z/OS. READ T alone is its execute form.
export const MVS38_BTAM_TYPES = {
  READ: new Set(['T', 'TB', 'TI', 'TT', 'TV', 'TP', 'TS', 'TQ', 'TC', 'TE', 'TM', 'TIR', 'TTR', 'TVR', 'TPR', 'TTA', 'TTL', 'TPL', 'TIQ', 'TRV', 'TCW', 'TBR', 'TMP', 'TBP', 'TQM']),
  WRITE: new Set(['TB', 'TI', 'TT', 'TV', 'TA', 'TS', 'TN', 'TR', 'TL', 'TD', 'TQ', 'TW', 'TC', 'TIR', 'TTR', 'TVR', 'TLR', 'TIO', 'TIV', 'TCO', 'TTV', 'TUS', 'TIX', 'TVO', 'TTX', 'TSR', 'TIE', 'TTE', 'TRM', 'TSA', 'TSF', 'TIVX', 'TTVX', 'TIXR', 'TTXR']),
};

// VTAM's basic-mode READ and WRITE, given RPL=, and the RPL fields they may set; z/OS
// Communications Server keeps SEND and RECEIVE and has no READ or WRITE.
export const MVS38_VTAM_RPL_KEYWORDS = new Set(['RPL', 'ACB', 'AREA', 'AREALEN', 'RECLEN', 'AAREA', 'AAREALN', 'ARECLEN', 'ECB', 'EXIT', 'OPTCD', 'ARG', 'BRANCH']);
