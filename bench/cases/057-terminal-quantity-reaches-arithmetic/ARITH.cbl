       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARITH.
      * A quantity typed at the terminal is moved into a zoned field
      * and multiplied, with nothing asking whether it is a number.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-QTY-X         PIC X(5).
       01 WS-QTY              PIC 9(5).
       01 WS-TOTAL            PIC 9(7).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           MOVE WS-QTY-X TO WS-QTY
           COMPUTE WS-TOTAL = WS-QTY * 10
           EXEC CICS RETURN END-EXEC.
