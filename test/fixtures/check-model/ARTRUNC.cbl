       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARTRUNC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-N                PIC 9(3).
       01 WS-I                PIC 9(2).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 100.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-N
           IF WS-N < 50
              COMPUTE WS-I = WS-N + 51
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
