       IDENTIFICATION DIVISION.
       PROGRAM-ID. CICSREADS.
      * A bound on WS-I holds across a CICS command only where the
      * command does not fill WS-I: LENGTH is given to WRITEQ TS and
      * returned by READQ TS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC S9(4) COMP.
       01 WS-LEN              PIC S9(4) COMP VALUE 2.
       01 WS-REC              PIC X(80).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-I) LENGTH(WS-LEN) END-EXEC
           IF WS-I >= 1 AND WS-I <= 10
              EXEC CICS WRITEQ TS QUEUE('Q1') FROM(WS-REC)
                   LENGTH(WS-I) END-EXEC
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           EXEC CICS RETURN END-EXEC.
