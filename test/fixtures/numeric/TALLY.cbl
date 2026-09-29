       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLY.
      * Counting what was typed gives a number the program made.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-FLAGS         PIC X(10).
       01 WS-DELETES          PIC 9(2) VALUE 0.
       01 WS-LEFT             PIC 9(2).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           INSPECT WS-FLAGS TALLYING WS-DELETES FOR ALL 'D'
           COMPUTE WS-LEFT = 10 - WS-DELETES
           EXEC CICS RETURN END-EXEC.
