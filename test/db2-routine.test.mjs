// SPDX-License-Identifier: AGPL-3.0-or-later
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readDb2, parseDb2Statement } from '../lib/db2/read.mjs';
import './pin-machine.mjs';

const parse = (sql) => parseDb2Statement(readDb2(sql).statements[0]);
const text = (toks) => toks && toks.map((t) => t.v).join(' ');
const node = (sql) => {
  const r = parse(sql);
  assert.equal(r.status, 'parsed', r.reason);
  return { ...r.node, body: text(r.node.body), wrapped: text(r.node.wrapped) };
};
const refused = (sql, reason) => {
  const r = parse(sql);
  assert.equal(r.status, 'unparsed', `${sql} parsed`);
  if (reason) assert.match(r.reason, reason, sql);
};

const param = (mode, name, type, locator = false) => ({ mode, name, type, locator });
const INTEGER = { name: 'INTEGER' };
const NATIVE = { kind: 'CREATE PROCEDURE', orReplace: false, routine: 'NATIVE SQL', language: 'SQL', external: null, security: null, wlmEnvironment: null, version: null, wrapped: null };

test('IBM native examples 1 and 2: a single UPDATE as the body, with the option list before it', () => {
  const head = ` CREATE PROCEDURE UPDATE_SALARY_1
 (IN EMPLOYEE_NUMBER CHAR(10),
 IN RATE DECIMAL(6,2))
 LANGUAGE SQL
 MODIFIES SQL DATA`;
  const tail = `
 UPDATE EMP
 SET SALARY = SALARY * RATE
 WHERE EMPNO = EMPLOYEE_NUMBER`;
  const parameters = [param('IN', 'EMPLOYEE_NUMBER', { name: 'CHAR', length: 10 }), param('IN', 'RATE', { name: 'DECIMAL', precision: 6, scale: 2 })];
  const body = 'UPDATE EMP SET SALARY = SALARY * RATE WHERE EMPNO = EMPLOYEE_NUMBER';
  assert.deepEqual(node(head + tail), { ...NATIVE, name: 'UPDATE_SALARY_1', parameters, options: { sqlDataAccess: 'MODIFIES SQL DATA' }, body });
  assert.deepEqual(node(`${head}\n DETERMINISTIC\n COMMIT ON RETURN YES${tail}`),
    { ...NATIVE, name: 'UPDATE_SALARY_1', parameters, options: { sqlDataAccess: 'MODIFIES SQL DATA', deterministic: true, commitOnReturn: 'YES' }, body });
});

test('IBM native example 3: array parameters and a compound body read to its last END', () => {
  const n = node(`CREATE PROCEDURE GETWEEKENDS(IN MYDATES DATEARRAY, OUT WEEKENDS DATEARRAY)
 BEGIN
 -- ARRAY INDEX VARIABLES
 DECLARE DATEINDEX, WEEKENDINDEX INT DEFAULT 1;
 DECLARE DATESCOUNT INT;
 SET DATESCOUNT = CARDINALITY(MYDATES);
 WHILE DATEINDEX <= DATESCOUNT DO
 IF DAYOFWEEK(MYDATES[DATEINDEX]) IN (1, 7) THEN
 SET WEEKENDS[WEEKENDINDEX] = MYDATES[DATEINDEX];
 SET WEEKENDINDEX = WEEKENDINDEX + 1;
 END IF;
 SET DATEINDEX = DATEINDEX + 1;
 END WHILE;
 END`);
  const array = { name: 'USER-DEFINED', userType: 'DATEARRAY' };
  assert.deepEqual({ ...n, body: null }, { ...NATIVE, name: 'GETWEEKENDS', parameters: [param('IN', 'MYDATES', array), param('OUT', 'WEEKENDS', array)], options: {}, body: null });
  assert.match(n.body, /^BEGIN DECLARE DATEINDEX .* END IF ; SET DATEINDEX = DATEINDEX \+ 1 ; END WHILE ; END$/);
});

test('IBM native example 4: an OUT array parameter and a SELECT INTO in the compound body', () => {
  assert.deepEqual(node(`CREATE PROCEDURE GET_PHONES(OUT EPHONES PHONELIST)
 BEGIN
 SELECT ARRAY_AGG(PHONENUMBER)
 INTO EPHONES
 FROM EMP_PHONES
 WHERE ID = 1775;
 END`), {
    ...NATIVE, name: 'GET_PHONES', parameters: [param('OUT', 'EPHONES', { name: 'USER-DEFINED', userType: 'PHONELIST' })], options: {},
    body: 'BEGIN SELECT ARRAY_AGG ( PHONENUMBER ) INTO EPHONES FROM EMP_PHONES WHERE ID = 1775 ; END',
  });
});

test('IBM external examples 1 and 2: unnamed IN INT parameters, the load module, its WLM environment and run options', () => {
  const head = ` CREATE PROCEDURE SYSPROC.MYPROC(IN INT, OUT INT, OUT DECIMAL(7,2))
 LANGUAGE COBOL
 EXTERNAL NAME MYMODULE`;
  const expected = {
    kind: 'CREATE PROCEDURE', orReplace: false, routine: 'EXTERNAL', name: 'SYSPROC.MYPROC',
    parameters: [param('IN', null, INTEGER), param('OUT', null, INTEGER), param('OUT', null, { name: 'DECIMAL', precision: 7, scale: 2 })],
    language: 'COBOL', external: { name: 'MYMODULE', implicit: false }, security: 'DB2', wlmEnvironment: { name: 'PARTSA', callerEnvironment: false },
    version: null, body: null, wrapped: null,
  };
  assert.deepEqual(node(`${head}\n PARAMETER STYLE GENERAL\n WLM ENVIRONMENT PARTSA\n DYNAMIC RESULT SETS 1;`),
    { ...expected, options: { parameterStyle: 'GENERAL', dynamicResultSets: 1 } });
  assert.deepEqual(node(`${head}\n PARAMETER STYLE SQL\n WLM ENVIRONMENT PARTSA\n DYNAMIC RESULT SETS 1\n RUN OPTIONS 'HEAP(,,ANY),BELOW(4K,,),ALL31(ON),STACK(,,ANY,)';`),
    { ...expected, options: { parameterStyle: 'SQL', dynamicResultSets: 1, runOptions: 'HEAP(,,ANY),BELOW(4K,,),ALL31(ON),STACK(,,ANY,)' } });
});

test('IBM external example 3: a Java procedure named by a quoted class and method', () => {
  assert.deepEqual(node(` CREATE PROCEDURE PARTS_ON_HAND(IN PARTNUM INT,
 OUT COST DECIMAL(7,2),
 OUT QUANTITY INT)
 LANGUAGE JAVA
 EXTERNAL NAME 'PARTS.ONHAND'
 PARAMETER STYLE JAVA;`), {
    kind: 'CREATE PROCEDURE', orReplace: false, routine: 'EXTERNAL', name: 'PARTS_ON_HAND',
    parameters: [param('IN', 'PARTNUM', INTEGER), param('OUT', 'COST', { name: 'DECIMAL', precision: 7, scale: 2 }), param('OUT', 'QUANTITY', INTEGER)],
    language: 'JAVA', external: { name: 'PARTS.ONHAND', implicit: false }, security: 'DB2', wlmEnvironment: null, version: null,
    options: { parameterStyle: 'JAVA' }, body: null, wrapped: null,
  });
});

test('IBM external SQL examples 1 and 2: FENCED with an EXTERNAL NAME makes the SQL procedure external', () => {
  const head = `CREATE PROCEDURE UPDATESALARY
 (IN EMPLOYEE_NUMBER CHAR(10),
 IN RATE DECIMAL(6,2))
 LANGUAGE SQL
 FENCED`;
  const expected = {
    kind: 'CREATE PROCEDURE', orReplace: false, routine: 'EXTERNAL SQL', name: 'UPDATESALARY',
    parameters: [param('IN', 'EMPLOYEE_NUMBER', { name: 'CHAR', length: 10 }), param('IN', 'RATE', { name: 'DECIMAL', precision: 6, scale: 2 })],
    language: 'SQL', security: 'DB2', version: null, body: 'UPDATE EMP SET SALARY = SALARY * RATE WHERE EMPNO = EMPLOYEE_NUMBER', wrapped: null,
  };
  const update = '\n UPDATE EMP\n SET SALARY = SALARY * RATE\n WHERE EMPNO = EMPLOYEE_NUMBER';
  assert.deepEqual(node(`${head}\n EXTERNAL NAME 'USALARY1'\n MODIFIES SQL DATA${update}`),
    { ...expected, external: { name: 'USALARY1', implicit: false }, wlmEnvironment: null, options: { fenced: true, sqlDataAccess: 'MODIFIES SQL DATA' } });
  assert.deepEqual(node(`${head}\n EXTERNAL NAME 'USALARY2'\n MODIFIES SQL DATA\n WLM ENVIRONMENT PARTSA\n DETERMINISTIC\n RUN OPTIONS 'MSGFILE(OUTFILE),RPTSTG(ON),RPTOPTS(ON)'\n COMMIT ON RETURN YES${update}`), {
    ...expected, external: { name: 'USALARY2', implicit: false }, wlmEnvironment: { name: 'PARTSA', callerEnvironment: false },
    options: { fenced: true, sqlDataAccess: 'MODIFIES SQL DATA', deterministic: true, runOptions: 'MSGFILE(OUTFILE),RPTSTG(ON),RPTOPTS(ON)', commitOnReturn: 'YES' },
  });
});

const EXTERNAL_FUNCTION = { kind: 'CREATE FUNCTION', orReplace: false, routine: 'EXTERNAL SCALAR', language: 'C', security: 'DB2', wlmEnvironment: null, version: null, body: null, wrapped: null };
const FLOAT = { name: 'FLOAT', precision: 53 };

test('IBM external scalar function examples 1 and 2: C functions with unnamed parameters', () => {
  assert.deepEqual(node(` CREATE FUNCTION NTEST1 (SMALLINT)
 RETURNS SMALLINT
 EXTERNAL NAME 'NTESTMOD'
 SPECIFIC MINENULL1
 LANGUAGE C
 DETERMINISTIC
 NO SQL
 FENCED
 PARAMETER STYLE SQL
 RETURNS NULL ON NULL INPUT
 NO EXTERNAL ACTION;`), {
    ...EXTERNAL_FUNCTION, name: 'NTEST1', parameters: [param('IN', null, { name: 'SMALLINT' })],
    returns: { type: { name: 'SMALLINT' }, castFrom: null, locator: false }, external: { name: 'NTESTMOD', implicit: false },
    options: { specific: 'MINENULL1', deterministic: true, sqlDataAccess: 'NO SQL', fenced: true, parameterStyle: 'SQL', calledOnNullInput: false, externalAction: false },
  });
  assert.deepEqual(node(` CREATE FUNCTION CENTER (INTEGER, FLOAT)
 RETURNS FLOAT
 EXTERNAL NAME 'MIDDLE'
 LANGUAGE C
 DETERMINISTIC
 NO SQL
 FENCED
 PARAMETER STYLE SQL
 NO EXTERNAL ACTION
 STAY RESIDENT YES;`), {
    ...EXTERNAL_FUNCTION, name: 'CENTER', parameters: [param('IN', null, INTEGER), param('IN', null, FLOAT)],
    returns: { type: FLOAT, castFrom: null, locator: false }, external: { name: 'MIDDLE', implicit: false },
    options: { deterministic: true, sqlDataAccess: 'NO SQL', fenced: true, parameterStyle: 'SQL', externalAction: false, stayResident: true },
  });
});

test('IBM external scalar function examples 3 and 4: RETURNS … CAST FROM, a default scratchpad, and a Java function', () => {
  assert.deepEqual(node(` CREATE FUNCTION SMITH.CENTER (FLOAT, FLOAT, FLOAT)
 RETURNS DECIMAL(8,4) CAST FROM FLOAT
 EXTERNAL NAME 'CMOD'
 SPECIFIC FOCUS98
 LANGUAGE C
 DETERMINISTIC
 NO SQL
 FENCED
 PARAMETER STYLE SQL
 NO EXTERNAL ACTION
 SCRATCHPAD
 NO FINAL CALL;`), {
    ...EXTERNAL_FUNCTION, name: 'SMITH.CENTER', parameters: [param('IN', null, FLOAT), param('IN', null, FLOAT), param('IN', null, FLOAT)],
    returns: { type: { name: 'DECIMAL', precision: 8, scale: 4 }, castFrom: FLOAT, locator: false }, external: { name: 'CMOD', implicit: false },
    options: { specific: 'FOCUS98', deterministic: true, sqlDataAccess: 'NO SQL', fenced: true, parameterStyle: 'SQL', externalAction: false, scratchpad: 100, finalCall: false },
  });
  assert.deepEqual(node(`CREATE FUNCTION FINDV (CLOB(100K))
 RETURNS INTEGER
 FENCED
 LANGUAGE JAVA
 PARAMETER STYLE JAVA
 EXTERNAL NAME 'JAVAUDFS.FINDVWL'
 NO EXTERNAL ACTION
 CALLED ON NULL INPUT
 DETERMINISTIC
 NO SQL;`), {
    ...EXTERNAL_FUNCTION, name: 'FINDV', language: 'JAVA', parameters: [param('IN', null, { name: 'CLOB', length: '100K' })],
    returns: { type: INTEGER, castFrom: null, locator: false }, external: { name: 'JAVAUDFS.FINDVWL', implicit: false },
    options: { fenced: true, parameterStyle: 'JAVA', externalAction: false, calledOnNullInput: true, deterministic: true, sqlDataAccess: 'NO SQL' },
  });
});

const SQL_FUNCTION = { kind: 'CREATE FUNCTION', orReplace: false, routine: 'SQL SCALAR', language: 'SQL', external: null, security: null, wlmEnvironment: null, version: null, wrapped: null };

test('IBM SQL scalar function examples: an inlined RETURN and a compiled compound body under its own terminator', () => {
  assert.deepEqual(node(` CREATE FUNCTION TAN (X DOUBLE)
 RETURNS DOUBLE
 LANGUAGE SQL
 CONTAINS SQL
 NO EXTERNAL ACTION
 DETERMINISTIC
 RETURN SIN(X)/COS(X);`), {
    ...SQL_FUNCTION, name: 'TAN', parameters: [param('IN', 'X', { name: 'DOUBLE' })], returns: { type: { name: 'DOUBLE' }, castFrom: null, locator: false },
    options: { sqlDataAccess: 'CONTAINS SQL', externalAction: false, deterministic: true }, body: 'RETURN SIN ( X ) / COS ( X )',
  });
  const n = node(`--#SET TERMINATOR #
 CREATE FUNCTION REVERSE(INSTR VARCHAR(4000))
 RETURNS VARCHAR(4000)
 DETERMINISTIC NO EXTERNAL ACTION CONTAINS SQL
 BEGIN
 DECLARE REVSTR, RESTSTR VARCHAR(4000) DEFAULT '';
 DECLARE LEN INT;
 IF INSTR IS NULL THEN
 RETURN NULL;
 END IF;
 SET (RESTSTR, LEN) = (INSTR, LENGTH(INSTR));
 WHILE LEN > 0 DO
 SET (REVSTR, RESTSTR, LEN)
 = (SUBSTR(RESTSTR, 1, 1) CONCAT REVSTR,
 SUBSTR(RESTSTR, 2, LEN - 1),
 LEN - 1);
 END WHILE;
 RETURN REVSTR;
 END#`);
  const varchar = { name: 'VARCHAR', length: 4000 };
  assert.deepEqual({ ...n, body: null }, {
    ...SQL_FUNCTION, name: 'REVERSE', parameters: [param('IN', 'INSTR', varchar)], returns: { type: varchar, castFrom: null, locator: false },
    options: { deterministic: true, externalAction: false, sqlDataAccess: 'CONTAINS SQL' }, body: null,
  });
  assert.match(n.body, /^BEGIN DECLARE REVSTR .* END WHILE ; RETURN REVSTR ; END$/);
});

test('a parameter name is optional for external routines and required for SQL ones', () => {
  assert.deepEqual(node('CREATE PROCEDURE P (IN P INT, IN INT, P2 CHAR(8), CHAR CHAR(8)) LANGUAGE C EXTERNAL;').parameters,
    [param('IN', 'P', INTEGER), param('IN', null, INTEGER), param('IN', 'P2', { name: 'CHAR', length: 8 }), param('IN', 'CHAR', { name: 'CHAR', length: 8 })]);
  refused('CREATE PROCEDURE P (IN INT) LANGUAGE SQL BEGIN END;', /names each parameter/);
  refused('CREATE PROCEDURE P (IN INT) LANGUAGE SQL FENCED BEGIN END;', /names each parameter/);
  refused('CREATE FUNCTION F (INT) RETURNS INT RETURN 1;', /names each parameter/);
});

test('parameter types: TABLE LIKE and LOB locators, CCSID encoding schemes, FOR BIT DATA and graphic types', () => {
  const n = node(`CREATE PROCEDURE P (IN T TABLE LIKE DSN8.EMP AS LOCATOR, IN BLOB(1M) AS LOCATOR, INOUT C CHAR(8) CCSID EBCDIC FOR BIT DATA,
    IN V VARCHAR(20) FOR MIXED DATA CCSID UNICODE, IN G GRAPHIC(4) CCSID UNICODE, IN D DBCLOB(1K) AS LOCATOR, OUT TS TIMESTAMP(12) WITH TIMEZONE)
    LANGUAGE COBOL EXTERNAL;`);
  assert.deepEqual(n.parameters, [
    param('IN', 'T', { name: 'TABLE LIKE', table: 'DSN8.EMP' }, true),
    param('IN', null, { name: 'BLOB', length: '1M' }, true),
    param('INOUT', 'C', { name: 'CHAR', length: 8, ccsid: 'EBCDIC', forData: 'BIT' }),
    param('IN', 'V', { name: 'VARCHAR', length: 20, forData: 'MIXED', ccsid: 'UNICODE' }),
    param('IN', 'G', { name: 'GRAPHIC', length: 4, ccsid: 'UNICODE' }),
    param('IN', 'D', { name: 'DBCLOB', length: '1K' }, true),
    param('OUT', 'TS', { name: 'TIMESTAMP', precision: 12, timeZone: true }),
  ]);
});

test('each routine form takes only the types its reference lists', () => {
  assert.equal(node('CREATE PROCEDURE P (IN X XML) LANGUAGE SQL BEGIN END;').parameters[0].type.name, 'XML');
  assert.equal(node('CREATE PROCEDURE P (IN ROWID) LANGUAGE C EXTERNAL;').parameters[0].type.name, 'ROWID');
  refused('CREATE PROCEDURE P (IN X ROWID) LANGUAGE SQL BEGIN END;', /ROWID is not a type/);
  refused('CREATE PROCEDURE P (IN XML) LANGUAGE COBOL EXTERNAL;', /XML is not a type/);
  refused('CREATE PROCEDURE P (IN X BIGINT) LANGUAGE SQL FENCED BEGIN END;', /BIGINT is not a type for a parameter of an external SQL procedure/);
  refused('CREATE PROCEDURE P (IN X CHAR(10) CCSID 37) LANGUAGE SQL BEGIN END;', /ASCII, EBCDIC or UNICODE, not a number/);
  refused('CREATE PROCEDURE P (IN X LONG VARCHAR) LANGUAGE SQL BEGIN END;', /LONG VARCHAR/);
  refused('CREATE PROCEDURE P (IN X INT AS LOCATOR) LANGUAGE C EXTERNAL;', /LOB or distinct type/);
  refused('CREATE FUNCTION F (X BLOB(1M) AS LOCATOR) RETURNS INT RETURN 1;', /AS LOCATOR is not allowed/);
});

test('external routine security: the program that runs, SECURITY with its DB2 default, and WLM ENVIRONMENT (name,*)', () => {
  const n = node(`CREATE OR REPLACE PROCEDURE ADM.PAYROLL (IN X INT) LANGUAGE PLI EXTERNAL SECURITY DEFINER WLM ENVIRONMENT (WLMPAY,*)
    COLLID PAYCOLL PROGRAM TYPE MAIN STAY RESIDENT YES ASUTIME LIMIT 5000 STOP AFTER 3 FAILURES NO DBINFO PARAMETER VARCHAR STRUCTURE;`);
  assert.deepEqual([n.orReplace, n.language, n.external, n.security, n.wlmEnvironment], [true, 'PLI', { name: 'PAYROLL', implicit: true }, 'DEFINER', { name: 'WLMPAY', callerEnvironment: true }]);
  assert.deepEqual(n.options, { collid: 'PAYCOLL', programType: 'MAIN', stayResident: true, asutime: 5000, stopAfterFailures: 3, dbinfo: false, parameterVarchar: 'STRUCTURE' });
  const f = node('CREATE FUNCTION F (INT) RETURNS INT LANGUAGE COBOL EXTERNAL NAME FMOD PARAMETER STYLE SQL SECURITY USER WLM ENVIRONMENT WLMF;');
  assert.deepEqual([f.external, f.security, f.wlmEnvironment], [{ name: 'FMOD', implicit: false }, 'USER', { name: 'WLMF', callerEnvironment: false }]);
  assert.equal(node('CREATE PROCEDURE P LANGUAGE SQL FENCED COMMIT;').external.name, 'P');
});

test("IBM's synonyms read as the clauses they stand for", () => {
  assert.deepEqual(node('CREATE PROCEDURE P (IN X INT) RESULT SETS 2 VARIANT NULL CALL LANGUAGE C EXTERNAL NAME Y PARAMETER STYLE DB2SQL;').options,
    { dynamicResultSets: 2, deterministic: false, calledOnNullInput: true, parameterStyle: 'SQL' });
  assert.deepEqual(node('CREATE PROCEDURE P (IN X INT) RESULT SET 1 NOT VARIANT LANGUAGE REXX EXTERNAL PARAMETER STYLE SIMPLE CALL WITH NULLS;').options,
    { dynamicResultSets: 1, deterministic: true, parameterStyle: 'GENERAL WITH NULLS' });
  assert.deepEqual(node('CREATE FUNCTION F (X INT) RETURNS INT NOT NULL CALL NOT VARIANT RETURN X;').options, { calledOnNullInput: false, deterministic: true });
});

test('native procedure options: the bind-like clauses, AUTONOMOUS, PACKAGE OWNER and SQL PATH', () => {
  assert.deepEqual(node(`CREATE PROCEDURE P () LANGUAGE SQL SPECIFIC S.P QUALIFIER Q1 PACKAGE OWNER R1 AS ROLE ISOLATION LEVEL UR DEGREE ANY
    DYNAMICRULES BIND AUTONOMOUS OPTHINT 'H1' RELEASE AT DEALLOCATE WITH KEEP DYNAMIC NODEFER PREPARE CURRENT DATA YES
    SQL PATH SYSIBM, SYSTEM PATH, SESSION_USER DECIMAL(31,2) QUERY ACCELERATION ENABLE WITH FAILBACK ACCELERATION WAITFORDATA 20.5
    APPLCOMPAT V12R1M500 CONCENTRATE STATEMENTS WITH LITERALS CONCURRENT ACCESS RESOLUTION WAIT FOR OUTCOME ARCHIVE SENSITIVE NO
    DATE FORMAT ISO ROUNDING DEC_ROUND_HALF_EVEN FOR UPDATE CLAUSE OPTIONAL WITH EXPLAIN ALLOW DEBUG MODE WLM ENVIRONMENT FOR DEBUG MODE WLMDBG
    BEGIN END;`).options, {
    specific: 'S.P', qualifier: 'Q1', packageOwner: { name: 'R1', as: 'ROLE' }, isolation: 'UR', degree: 'ANY', dynamicRules: 'BIND',
    commitOnReturn: 'AUTONOMOUS', optHint: 'H1', releaseAt: 'DEALLOCATE', keepDynamic: true, deferPrepare: false, currentData: true,
    sqlPath: ['SYSIBM', 'SYSTEM PATH', 'SESSION_USER'], decimalArithmetic: { precision: 31, scale: 2 }, queryAcceleration: 'ENABLE WITH FAILBACK',
    accelerationWaitForData: 20.5, applcompat: 'V12R1M500', concentrateStatements: 'WITH LITERALS', concurrentAccessResolution: 'WAIT FOR OUTCOME',
    archiveSensitive: false, dateFormat: 'ISO', rounding: 'DEC_ROUND_HALF_EVEN', forUpdateClause: 'OPTIONAL', explain: true, debugMode: 'ALLOW', debugWlmEnvironment: 'WLMDBG',
  });
});

test('a native procedure keeps the clauses it ignores for compatibility apart, and refuses a plain WLM ENVIRONMENT', () => {
  const n = node('CREATE PROCEDURE P () LANGUAGE SQL SECURITY USER STAY RESIDENT YES COLLID C1 CONTINUE AFTER FAILURES PARAMETER STYLE GENERAL WITH NULLS BEGIN END;');
  assert.deepEqual([n.security, n.external, n.options], [null, null, { ignored: { security: 'USER', stayResident: true, collid: 'C1', stopAfterFailures: false, parameterStyle: 'GENERAL WITH NULLS' } }]);
  refused('CREATE PROCEDURE P () LANGUAGE SQL WLM ENVIRONMENT WLMENV1 BEGIN END;', /WLM ENVIRONMENT is not a clause of a native SQL procedure/);
});

test('VERSION opens a native procedure definition, and WRAPPED stands for everything after the parameters', () => {
  const n = node('CREATE OR REPLACE PROCEDURE P (IN X INT) VERSION V2 LANGUAGE SQL BEGIN END;');
  assert.deepEqual([n.orReplace, n.version, n.body], [true, 'V2', 'BEGIN END']);
  refused('CREATE PROCEDURE P (IN X INT) LANGUAGE SQL VERSION V2 BEGIN END;', /VERSION comes before the other clauses/);
  const w = node('CREATE PROCEDURE P (IN X INT) WRAPPED SQL11010 ablGWmdiWmtyTmdKTmJqTmdKTmZq;');
  assert.deepEqual([w.routine, w.options, w.body, w.wrapped], ['NATIVE SQL', {}, null, 'SQL11010 ablGWmdiWmtyTmdKTmJqTmdKTmZq']);
  assert.equal(node('CREATE FUNCTION F (X INT) WRAPPED SQL11010 abc;').routine, 'SQL SCALAR');
  refused('CREATE PROCEDURE P (IN X INT) WRAPPED;');
});

test('each clause at most once, a choice group counting as one clause', () => {
  refused('CREATE PROCEDURE P () LANGUAGE COBOL EXTERNAL NAME X DETERMINISTIC NOT VARIANT;', /no second deterministic/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL MODIFIES SQL DATA READS SQL DATA BEGIN END;', /no second sqlDataAccess/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL COMMIT ON RETURN YES AUTONOMOUS BEGIN END;', /no second commitOnReturn/);
});

test('each form refuses the clauses its reference does not list', () => {
  refused('CREATE PROCEDURE P () LANGUAGE SQL NO SQL BEGIN END;', /NO SQL is not a clause of a native SQL procedure/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL NOT NULL CALL BEGIN END;', /NOT NULL CALL/);
  refused('CREATE PROCEDURE P () LANGUAGE COBOL EXTERNAL QUALIFIER Q;', /QUALIFIER is not a clause of an external procedure/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL FENCED SPECIFIC P BEGIN END;', /SPECIFIC is not a clause of an external SQL procedure/);
  refused('CREATE FUNCTION F (INT) RETURNS INT LANGUAGE REXX EXTERNAL PARAMETER STYLE SQL;', /LANGUAGE REXX is not a clause of an external scalar function/);
  refused('CREATE FUNCTION F (X INT) RETURNS INT DYNAMIC RESULT SETS 1 RETURN X;', /DYNAMIC RESULT SETS/);
});

test('an external routine needs EXTERNAL and LANGUAGE, an external function PARAMETER STYLE too, and has no body', () => {
  refused('CREATE PROCEDURE P () LANGUAGE COBOL;', /expected EXTERNAL/);
  refused('CREATE PROCEDURE P () EXTERNAL NAME X;', /expected LANGUAGE/);
  refused('CREATE FUNCTION F (X INT) RETURNS INT LANGUAGE C EXTERNAL NAME F1;', /expected PARAMETER STYLE/);
  refused('CREATE PROCEDURE P () LANGUAGE COBOL EXTERNAL BEGIN END;', /external procedure clause at 'BEGIN'/);
  refused('CREATE OR REPLACE PROCEDURE P LANGUAGE SQL FENCED BEGIN END;', /no OR REPLACE/);
});

test('the routine body: one statement, a labelled compound ending at its own END, or nothing a statement cannot start', () => {
  assert.equal(node('CREATE PROCEDURE P () LANGUAGE SQL P1: BEGIN L2: LOOP LEAVE L2; END LOOP L2; END P1;').body, 'P1 : BEGIN L2 : LOOP LEAVE L2 ; END LOOP L2 ; END P1');
  assert.equal(node('CREATE PROCEDURE P () LANGUAGE SQL BEGIN END;').body, 'BEGIN END');
  assert.deepEqual([node('CREATE PROCEDURE P () LANGUAGE SQL COMMIT ON RETURN YES COMMIT;').options, node('CREATE PROCEDURE P LANGUAGE SQL COMMIT;').body], [{ commitOnReturn: 'YES' }, 'COMMIT']);
  refused('CREATE PROCEDURE P () LANGUAGE SQL P1: BEGIN END P2;', /end of the statement after the routine body at 'P2'/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL BEGIN END BEGIN END;', /end of the statement/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL;', /routine body at end of statement/);
  refused("CREATE FUNCTION F (X INT) RETURNS INT UPDATE T SET C = 1;", /SQL scalar function clause or an SQL routine body at 'UPDATE'/);
});

test('CASE expressions and END IF, END WHILE and END CASE inside a compound body do not end it', () => {
  const n = node(`--#SET TERMINATOR @
CREATE PROCEDURE P (IN X INT, OUT Y INT)
BEGIN
  SET Y = CASE WHEN X > 0 THEN 1 ELSE 0 END;
  CASE Y WHEN 1 THEN SET Y = 2; ELSE SET Y = 3; END CASE;
  WHILE Y < 9 DO SET Y = Y + 1; END WHILE;
END@`);
  assert.match(n.body, /^BEGIN SET Y = CASE .* END WHILE ; END$/);
});

test('a function has no OR REPLACE, VERSION only straight after a leading RETURNS, and RETURNS first unless it is inlined', () => {
  refused('CREATE OR REPLACE FUNCTION F (X INT) RETURNS INT RETURN X;', /no CREATE OR REPLACE FUNCTION/);
  assert.equal(node('CREATE FUNCTION F (X INT) RETURNS INT VERSION V1 LANGUAGE SQL RETURN X;').version, 'V1');
  refused('CREATE FUNCTION F (X INT) LANGUAGE SQL RETURNS INT VERSION V1 RETURN X;', /straight after a leading RETURNS/);
  assert.equal(node('CREATE FUNCTION F (X INT) LANGUAGE SQL RETURNS INT RETURN X;').body, 'RETURN X');
  refused('CREATE FUNCTION F (X INT) LANGUAGE SQL RETURNS INT BEGIN RETURN X; END;', /RETURNS comes first in a compiled SQL scalar function/);
  refused('CREATE FUNCTION F (X INT) RETURNS INT CAST FROM DOUBLE RETURN X;', /CAST FROM and AS LOCATOR/);
  refused('CREATE FUNCTION F (IN X INT) RETURNS INT RETURN X;', /take no IN, OUT or INOUT/);
  refused('CREATE FUNCTION F RETURNS INT RETURN 1;', /a function lists its parameters/);
});

test('table and sourced functions are refused as not read', () => {
  refused('CREATE FUNCTION F (X INT) RETURNS TABLE (A INT) LANGUAGE SQL RETURN SELECT A FROM T;', /table functions are not read/);
  refused('CREATE FUNCTION F (X MONEY) RETURNS DECIMAL(9,2) SOURCE SYSIBM.SUM(DECIMAL(9,2));', /sourced functions are not read/);
});

test('PostgreSQL routines are refused at the dialect', () => {
  refused("CREATE OR REPLACE PROCEDURE p() LANGUAGE plpgsql AS $$ BEGIN RAISE NOTICE 'x'; END $$;", /PL\/pgSQL is PostgreSQL/);
  refused("CREATE FUNCTION f(x integer) RETURNS integer AS 'select $1' LANGUAGE SQL;", /AS before a routine body/);
  refused("CREATE FUNCTION f(x int) RETURNS int AS '/usr/lib/f.so', 'f' LANGUAGE C STRICT;", /AS before a routine body/);
  refused('CREATE OR REPLACE FUNCTION update_audit_fields()\nRETURNS TRIGGER AS $$\nBEGIN\n RETURN NEW;\nEND;', /no CREATE OR REPLACE FUNCTION/);
});

test('MySQL, Transact-SQL, Oracle and Db2 for i routines are refused at the dialect', () => {
  refused('CREATE PROCEDURE p(IN x INT) BEGIN SELECT 1 FROM t; END //\nDELIMITER ;', /MySQL DELIMITER/);
  refused("CREATE PROCEDURE p(IN x INT) COMMENT 'adds' BEGIN SELECT 1 FROM t; END;", /COMMENT 'text' is MySQL/);
  refused('CREATE PROCEDURE p(IN x INT) SQL SECURITY DEFINER BEGIN SELECT 1 FROM t; END;', /SQL SECURITY is MySQL/);
  refused("CREATE PROCEDURE HelloWorld AS\nPRINT 'Hello, World'\nRETURN (0)", /AS before a routine body/);
  refused('CREATE PROCEDURE dbo.p @x INT AS SELECT 1;', /Transact-SQL/);
  refused('CREATE OR REPLACE PROCEDURE p (x IN NUMBER) IS BEGIN NULL; END;', /mode after the parameter name is Oracle/);
  refused('CREATE OR REPLACE PROCEDURE TEHMSDTA/RSQAVAIL (IN P_CAT CHAR(6)) LANGUAGE SQL BEGIN END;', /Db2 for i system naming/);
});

test('Db2 for LUW clauses are refused', () => {
  refused('CREATE PROCEDURE P (IN X INT) LANGUAGE SQL NOT FENCED THREADSAFE BEGIN END;', /Db2 for LUW clause/);
  refused('CREATE PROCEDURE P () LANGUAGE SQL NEW SAVEPOINT LEVEL BEGIN END;', /Db2 for LUW clause/);
  refused("CREATE PROCEDURE P (IN X INT) LANGUAGE C EXTERNAL NAME 'lib!f' PARAMETER STYLE DB2GENERAL;", /expected SQL, GENERAL, GENERAL WITH NULLS or JAVA at 'DB2GENERAL'/);
  refused('CREATE PROCEDURE P (IN X INT) LANGUAGE SQL NO EXTERNAL ACTION BEGIN END;', /NO EXTERNAL ACTION is not a clause of a native SQL procedure/);
  refused('CREATE PROCEDURE P (IN X INT) LANGUAGE CLR EXTERNAL NAME X;', /expected ASSEMBLE, C, COBOL, JAVA, PLI, REXX or SQL/);
});
