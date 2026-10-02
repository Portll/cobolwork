       IDENTIFICATION DIVISION.
       PROGRAM-ID. LINKAREA.
      * As LINKLOOP, but the name lies in the communication area each
      * program linked to may change.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-AREA.
          05 WS-PGM           PIC X(8).
          05 WS-REC           PIC X(72).
       01 WS-LEN              PIC S9(4) COMP.
       PROCEDURE DIVISION.
           MOVE LENGTH OF WS-PGM TO WS-LEN
           EXEC CICS RECEIVE INTO(WS-PGM) LENGTH(WS-LEN) END-EXEC
           IF WS-PGM NOT = 'ACCTINQ'
              EXEC CICS RETURN END-EXEC
           END-IF
           PERFORM 3 TIMES
              EXEC CICS LINK PROGRAM(WS-PGM) COMMAREA(WS-AREA) END-EXEC
           END-PERFORM
           EXEC CICS RETURN END-EXEC.
