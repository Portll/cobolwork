       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARNEG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-N                PIC S9(3).
       01 WS-I                PIC S9(3).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 100.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-N
           DIVIDE 16 INTO WS-N GIVING WS-I
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
