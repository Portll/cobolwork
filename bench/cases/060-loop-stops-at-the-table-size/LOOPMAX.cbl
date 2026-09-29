       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPMAX.
      * The loop stops at the table's own size, whatever was typed.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-COUNT         PIC 9(2).
       01 WS-MAX              PIC 9(2) VALUE 10.
       01 WS-I                PIC 9(2).
       01 WS-ROWS.
          05 WS-ROW           PIC X(40) OCCURS 10.
       01 WS-OUT              PIC X(40).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > WS-MAX
              MOVE WS-ROW(WS-I) TO WS-OUT
              EXEC CICS SEND FROM(WS-OUT) END-EXEC
           END-PERFORM
           EXEC CICS RETURN END-EXEC.
