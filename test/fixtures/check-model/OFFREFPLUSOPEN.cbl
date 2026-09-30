       IDENTIFICATION DIVISION.
       PROGRAM-ID. OFFREFPLUSOPEN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-A                PIC 9(4).
       01 WS-X                PIC X(10).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-A

           MOVE WS-IN TO WS-X(WS-A + 1 :)
           GOBACK.
