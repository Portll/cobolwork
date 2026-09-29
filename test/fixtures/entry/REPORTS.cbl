       IDENTIFICATION DIVISION.
       PROGRAM-ID. REPORTS.
      * Reached from MNU1 through MENU. Runs a typed command.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-CMD           PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           CALL 'SYSTEM' USING WS-CMD
           EXEC CICS RETURN END-EXEC.
