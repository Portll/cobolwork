       IDENTIFICATION DIVISION.
       PROGRAM-ID. WHENBOUND.
      * The check is an EVALUATE branch rather than an IF.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IDX              PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IDX FROM COMMAND-LINE
           EVALUATE TRUE
              WHEN WS-IDX < 1
              WHEN WS-IDX > 10
                 GOBACK
              WHEN OTHER
                 MOVE 'X' TO WS-ENTRY(WS-IDX)
           END-EVALUATE
           GOBACK.
