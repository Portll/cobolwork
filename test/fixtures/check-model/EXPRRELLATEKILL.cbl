       IDENTIFICATION DIVISION.
       PROGRAM-ID. EXPRRELLATEKILL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-A                PIC 9(4).
       01 WS-N                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-A
           IF WS-A > WS-N
              GOBACK
           END-IF
           MOVE WS-IN TO WS-N
           IF WS-N > 10
              GOBACK
           END-IF
           IF WS-A < 1
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-A)
           GOBACK.
