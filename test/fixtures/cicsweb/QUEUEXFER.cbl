       IDENTIFICATION DIVISION.
       PROGRAM-ID. QUEUEXFER.
      * A queue item, and the data a START passed, were written by
      * another task, and here each chooses the program run next.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PGM              PIC X(8).
       01 WS-NEXT             PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS READQ TS QUEUE('Q1') INTO(WS-PGM) END-EXEC
           EXEC CICS RETRIEVE INTO(WS-NEXT) END-EXEC
           IF WS-PGM = SPACES
              EXEC CICS XCTL PROGRAM(WS-NEXT) END-EXEC
           END-IF
           EXEC CICS XCTL PROGRAM(WS-PGM) END-EXEC.
