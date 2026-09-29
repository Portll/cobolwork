       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONVERT.
      * NUMVAL returns a number the program computed, so what reaches
      * the arithmetic is valid whatever was typed.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-QTY-X         PIC X(5).
       01 WS-QTY              PIC 9(5).
       01 WS-TOTAL            PIC 9(7).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           COMPUTE WS-QTY = FUNCTION NUMVAL(WS-QTY-X)
           COMPUTE WS-TOTAL = WS-QTY * 10
           EXEC CICS RETURN END-EXEC.
