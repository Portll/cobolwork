       IDENTIFICATION DIVISION.
       PROGRAM-ID. SELROW.
      * The row number the user typed picks an entry from a ten-entry
      * table, with nothing between the screen and the subscript.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-SEL           PIC 9(2).
       01 WS-ROWS.
          05 WS-ROW           PIC X(40) OCCURS 10.
       01 WS-OUT              PIC X(40).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           MOVE WS-ROW(WS-SEL) TO WS-OUT
           EXEC CICS SEND FROM(WS-OUT) END-EXEC
           EXEC CICS RETURN END-EXEC.
