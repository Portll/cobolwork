       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPN.
      * How many rows to list comes from the terminal, and the counter
      * that walks to it subscripts a ten-row table.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-COUNT         PIC 9(2).
       01 WS-I                PIC 9(2).
       01 WS-ROWS.
          05 WS-ROW           PIC X(40) OCCURS 10.
       01 WS-OUT              PIC X(40).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > WS-COUNT
              MOVE WS-ROW(WS-I) TO WS-OUT
              EXEC CICS SEND FROM(WS-OUT) END-EXEC
           END-PERFORM
           EXEC CICS RETURN END-EXEC.
