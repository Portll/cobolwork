       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARZERO.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-N                PIC 9(3).
       01 WS-D                PIC 9(3).
       01 WS-I                PIC 9(3).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 100.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-N
           MOVE WS-IN TO WS-D
           IF WS-D < 50
              DIVIDE WS-D INTO WS-N GIVING WS-I
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
