       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARONEWAY.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-K                PIC 9(9) COMP-5.
       01 WS-I                PIC 9(9) COMP-5.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 50.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-K
           IF WS-IN = 'A'
              IF WS-K < 50
                 COMPUTE WS-I = WS-K + 1
              END-IF
           ELSE
              MOVE WS-IN TO WS-I
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
