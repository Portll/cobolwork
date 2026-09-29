       IDENTIFICATION DIVISION.
       PROGRAM-ID. INDEXCHECKED.
      * The same, with a bound on the index before it is used.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-N                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10 INDEXED BY TX.
       PROCEDURE DIVISION.
           ACCEPT WS-N FROM COMMAND-LINE
           SET TX TO WS-N
           IF TX > 10
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(TX)
           GOBACK.
