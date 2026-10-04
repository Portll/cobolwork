// SPDX-License-Identifier: AGPL-3.0-or-later
// EXEC CICS, EXEC SQL and EXEC DLI written in assembler, read by the same code that reads them in
// COBOL: the CICS command table and option reader, and the SQL host-variable reader.
import { HlasmSyntax } from './operands.mjs';
import { cicsOptions, cicsCommand } from '../precompile-cics.mjs';
import { hostVariableRoles } from '../embedded-sql.mjs';

const after = (st, word) => (st.field || '').replace(new RegExp(`^${word}\\b\\s*`, 'i'), '');

export const parsers = {
  'EXEC CICS': (st) => {
    const options = cicsOptions(after(st, 'CICS'));
    const command = cicsCommand(options);
    if (!command) throw new HlasmSyntax(`${options[0]?.word || 'nothing'} is not a CICS command the command table holds`);
    return { kind: 'EXEC CICS', command, options };
  },
  'EXEC SQL': (st) => {
    const sql = after(st, 'SQL');
    if (!sql) throw new HlasmSyntax('EXEC SQL holds no statement');
    return { kind: 'EXEC SQL', sql, hostVariables: hostVariableRoles(sql) };
  },
  'EXEC DLI': (st) => {
    const options = cicsOptions(after(st, 'DLI'));
    if (!options.length) throw new HlasmSyntax('EXEC DLI holds no command');
    return { kind: 'EXEC DLI', command: options[0].word, options };
  },
};
