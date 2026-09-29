       IDENTIFICATION DIVISION.
       PROGRAM-ID. BOUNDED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IDX              PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IDX FROM COMMAND-LINE
           IF WS-IDX < 1 OR WS-IDX > 10
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-IDX)
           GOBACK.
