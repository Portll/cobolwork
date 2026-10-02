       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOGIN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-DB-PASSWORD      PIC X(16) VALUE SPACES.
       01 WS-PASSWORD-PROMPT  PIC X(20) VALUE 'Enter password:'.
       01 WS-PASSWORD-MASK    PIC X(8)  VALUE '********'.
      *01 WS-OLD-PASSWORD     PIC X(16) VALUE 'Tr0ub4dor3xQz9'.
       01 WS-PASSWORD-STATE   PIC X     VALUE 'N'.
           88 PASSWORD-OK               VALUE 'Y'.
           88 PASSWORD-EXPIRED          VALUE 'EXPD'.
       01 WS-PARSER.
           05 WS-TOKEN        PIC X(30) VALUE 'UNKNOWN'.
           05 WS-TOKEN-KIND   PIC X     VALUE '1'.
              88 TOKEN-IS-CICS-RESERVED VALUE 'ABCODE'.
       77 SQL-SYNTAX-TOKEN-MISSING PIC X(5) VALUE '37501'.
     88 TOKEN-KEY VALUE '1'.
       01 WS-PASSWORD-AREA.
           05 WS-NAME         PIC X(8)  VALUE 'Tr0ub4do'.
       01 WS-PASSWORD-ERROR   PIC X(40)
                              VALUE "Password must be 8-12 characters".
       PROCEDURE DIVISION.
           EXEC SQL CONNECT TO SAMPLE USER :WS-USER USING :WS-DB-PASSWORD END-EXEC.
           EXEC CICS SIGNON USERID(WS-USER) PASSWORD(WS-DB-PASSWORD) END-EXEC.
      * The test region took PASSWORD('TEMP0001') before RACF.
           EXEC CICS CHANGE TASK PRIORITY(100) END-EXEC.
           EXEC SQL CONNECT :WS-USER IDENTIFIED BY :WS-DB-PASSWORD END-EXEC.
           STOP RUN.
      * Example from documentation, not a real credential:
           EXEC SQL CONNECT TO 'database' USER 'user' USING 'password' END-EXEC.
           EXEC CICS VERIFY PASSWORD('password') USERID('userid') END-EXEC.
