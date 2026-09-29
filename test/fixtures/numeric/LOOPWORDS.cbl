       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPWORDS.
      * Two counters, the outer one written in words, both from input.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-ROWS-WANTED   PIC 9(2).
          05 WS-COLS-WANTED   PIC 9(2).
       01 WS-I                PIC 9(2).
       01 WS-J                PIC 9(2).
       01 WS-GRID.
          05 WS-LINE OCCURS 10.
             10 WS-CELL       PIC X(8) OCCURS 5.
       01 WS-OUT              PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           PERFORM SHOW-CELL
              VARYING WS-I FROM 1 BY 1
                UNTIL WS-I GREATER THAN OR EQUAL TO WS-ROWS-WANTED
              AFTER WS-J FROM 1 BY 1
                UNTIL WS-J > WS-COLS-WANTED
           EXEC CICS RETURN END-EXEC.
       SHOW-CELL.
           MOVE WS-CELL(WS-I, WS-J) TO WS-OUT.
