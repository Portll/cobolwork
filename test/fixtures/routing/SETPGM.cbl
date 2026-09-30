       IDENTIFICATION DIVISION.
       PROGRAM-ID. SETPGM.
      * An operator screen disables whichever program the terminal names.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-PGM      PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EXEC CICS SET PROGRAM(WS-PGM) DISABLED END-EXEC
           EXEC CICS RETURN END-EXEC.
