       IDENTIFICATION DIVISION.
       PROGRAM-ID. RPTSUB.
      * The same request written to an audit queue, which the CSD
      * sends to an ordinary log DD.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REQUEST.
          05 WS-REPORT        PIC X(8).
          05 WS-FROM          PIC X(10).
       01 JCL-RECORD          PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-REQUEST) END-EXEC
           STRING '//RPT EXEC PGM=' WS-REPORT ',PARM=' WS-FROM
              DELIMITED BY SIZE INTO JCL-RECORD
           EXEC CICS WRITEQ TD QUEUE('AUDT') FROM(JCL-RECORD)
                LENGTH(80) END-EXEC
           EXEC CICS RETURN END-EXEC.
