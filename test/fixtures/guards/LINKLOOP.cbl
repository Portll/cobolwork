       IDENTIFICATION DIVISION.
       PROGRAM-ID. LINKLOOP.
      * The program linked to is checked once, then linked on each
      * pass of a loop.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PGM              PIC X(8).
       01 WS-LEN              PIC S9(4) COMP.
       01 WS-AREA             PIC X(80).
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
