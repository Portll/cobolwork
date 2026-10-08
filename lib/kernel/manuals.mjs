// SPDX-License-Identifier: AGPL-3.0-or-later
// IBM manual passages a rule's remedy rests on, as `references` entries: the manual's title, the
// section heading as IBM Docs prints it, and the IBM Docs page for that section.
const ref = (title, section, url) => Object.freeze({ title, section, url });

const COBOL_LR = 'Enterprise COBOL for z/OS Language Reference';
const COBOL_PG = 'Enterprise COBOL for z/OS Programming Guide';
const DB2_SQL = 'Db2 for z/OS SQL Reference';
const DB2_APSG = 'Db2 for z/OS Application Programming and SQL Guide';
const CICS = 'CICS Transaction Server for z/OS';
const JCL = 'z/OS MVS JCL Reference';
const JES_AP = 'z/OS JES Application Programming';
const MVS_AUTH = 'z/OS MVS Programming: Authorized Assembler Services Guide';
const IMS_SUR = 'IMS System Utilities';
const PLI_LR = 'Enterprise PL/I for z/OS Language Reference';

const COBOL = 'https://www.ibm.com/docs/en/cobol-zos/6.4.0?topic=';
const DB2 = 'https://www.ibm.com/docs/en/db2-for-zos/13.0.0?topic=';
const CICS_URL = 'https://www.ibm.com/docs/en/cics-ts/6.x?topic=';
const ZOS = 'https://www.ibm.com/docs/en/zos/3.1.0?topic=';

export const IBM = Object.freeze({
  string: ref(COBOL_LR, 'STRING statement', `${COBOL}statements-string-statement`),
  unstring: ref(COBOL_LR, 'UNSTRING statement', `${COBOL}statements-unstring-statement`),
  evaluate: ref(COBOL_LR, 'Executing the EVALUATE statement', `${COBOL}statement-executing-evaluate`),
  goToDepending: ref(COBOL_LR, 'Conditional GO TO', `${COBOL}statement-conditional-go`),
  classCondition: ref(COBOL_LR, 'Class condition', `${COBOL}expressions-class-condition`),
  sizeError: ref(COBOL_LR, 'SIZE ERROR phrases', `${COBOL}operations-size-error-phrases`),
  referenceModification: ref(COBOL_LR, 'Reference modification', `${COBOL}reference-modification`),
  subscripting: ref(COBOL_LR, 'Subscripting', `${COBOL}reference-subscripting`),
  occursDepending: ref(COBOL_LR, 'OCCURS DEPENDING ON clause', `${COBOL}clause-occurs-depending`),
  call: ref(COBOL_LR, 'CALL statement', `${COBOL}statements-call-statement`),
  xmlParse: ref(COBOL_LR, 'XML PARSE statement', `${COBOL}statements-xml-parse-statement`),
  fileStatus: ref(COBOL_LR, 'FILE STATUS clause', `${COBOL}section-file-status-clause`),
  errorDeclarative: ref(COBOL_LR, 'EXCEPTION/ERROR declarative', `${COBOL}statement-exceptionerror-declarative`),
  ssrange: ref(COBOL_PG, 'SSRANGE', `${COBOL}options-ssrange`),
  xmlparseOption: ref(COBOL_PG, 'XMLPARSE', `${COBOL}options-xmlparse`),
  trunc: ref(COBOL_PG, 'TRUNC', `${COBOL}options-trunc`),
  arith: ref(COBOL_PG, 'ARITH', `${COBOL}options-arith`),
  numericClassTest: ref(COBOL_PG, 'Checking for incompatible data (numeric class test)', `${COBOL}arithmetic-checking-incompatible-data-numeric-class-test`),
  variableLengthTables: ref(COBOL_PG, 'Creating variable-length tables (DEPENDING ON)', `${COBOL}tables-creating-variable-length-depending`),
  dynamicCalls: ref(COBOL_PG, 'Making dynamic calls', `${COBOL}program-making-dynamic-calls`),
  fileStatusKeys: ref(COBOL_PG, 'Using file status keys', `${COBOL}operations-using-file-status-keys`),
  intermediateResults: ref(COBOL_PG, 'Intermediate results and arithmetic precision', `${COBOL}appendixes-intermediate-results-arithmetic-precision`),
  prepare: ref(DB2_SQL, 'PREPARE', `${DB2}statements-prepare`),
  executeImmediate: ref(DB2_SQL, 'EXECUTE IMMEDIATE', `${DB2}statements-execute-immediate`),
  whenever: ref(DB2_SQL, 'WHENEVER', `${DB2}statements-whenever`),
  revoke: ref(DB2_SQL, 'REVOKE', `${DB2}statements-revoke`),
  grantTable: ref(DB2_SQL, 'GRANT (table or view privileges)', `${DB2}statements-grant-table-view-privileges`),
  grantSystem: ref(DB2_SQL, 'GRANT (system privileges)', `${DB2}statements-grant-system-privileges`),
  dynamicSql: ref(DB2_APSG, 'Including dynamic SQL in your program', `${DB2}programming-including-dynamic-sql-in-your-program`),
  xctl: ref(CICS, 'XCTL', `${CICS_URL}summary-xctl`),
  link: ref(CICS, 'LINK', `${CICS_URL}summary-link`),
  verifyPassword: ref(CICS, 'VERIFY PASSWORD', `${CICS_URL}summary-verify-password`),
  eibFields: ref(CICS, 'EIB fields', `${CICS_URL}reference-eib-fields`),
  commandSecurity: ref(CICS, 'Command security', `${CICS_URL}cics-command-security`),
  dlm: ref(JCL, 'DLM parameter', `${ZOS}statement-dlm-parameter`),
  internalReader: ref(JES_AP, 'Submitting to the internal reader from jobs or tasks', `${ZOS}facility-submitting-internal-reader-from-jobs-tasks`),
  modeset: ref(MVS_AUTH, 'Changing system status (MODESET)', `${ZOS}system-changing-status-modeset`),
  pcbStatement: ref(IMS_SUR, 'Full-function or Fast Path database PCB statement', 'https://www.ibm.com/docs/en/ims/15.5.0?topic=statements-full-function-fast-path-database-pcb-statement'),
  sensegStatement: ref(IMS_SUR, 'SENSEG statement', 'https://www.ibm.com/docs/en/ims/15.5.0?topic=statements-senseg-statement'),
  pliOn: ref(PLI_LR, 'ON statement', 'https://www.ibm.com/docs/en/epfz/6.2.0?topic=units-statement'),
  pliFetch: ref(PLI_LR, 'FETCH statement', 'https://www.ibm.com/docs/en/epfz/6.2.0?topic=directives-fetch-statement'),
});
