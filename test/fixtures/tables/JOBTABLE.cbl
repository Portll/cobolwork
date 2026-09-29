       IDENTIFICATION DIVISION.
       PROGRAM-ID. JOBTABLE.
      * CardDemo's shape: a checked date is built into job text, read
      * back as card images, and submitted. An unchecked field shares a
      * group with the job record, which is not a route to it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-VARS.
          05 WS-OTHER         PIC X(10).
          05 JCL-RECORD       PIC X(80).
       01 JOB-DATA.
          02 JOB-DATA-1.
             05 FILLER        PIC X(20) VALUE '//STEP1 EXEC PGM=RPT'.
             05 FILLER        PIC X(6) VALUE ',PARM='.
             05 PARM-DATE     PIC X(10).
             05 FILLER        PIC X(124) VALUE SPACES.
          02 JOB-DATA-2 REDEFINES JOB-DATA-1.
             05 JOB-LINES     PIC X(80) OCCURS 2.
       01 WS-IN.
          05 IN-DATE          PIC X(10).
          05 IN-NOTE          PIC X(10).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-IN) END-EXEC
           IF IN-DATE IS NOT NUMERIC
              EXEC CICS RETURN END-EXEC
           END-IF
           MOVE IN-DATE TO PARM-DATE
           MOVE IN-NOTE TO WS-OTHER
           MOVE JOB-LINES(1) TO JCL-RECORD
           EXEC CICS WRITEQ TD QUEUE('JOBS') FROM(JCL-RECORD)
                LENGTH(80) END-EXEC
           EXEC CICS RETURN END-EXEC.
