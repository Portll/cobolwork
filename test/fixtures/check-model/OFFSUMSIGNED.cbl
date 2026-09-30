       IDENTIFICATION DIVISION.
       PROGRAM-ID. OFFSUMSIGNED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-A                PIC S9(4).
       01 WS-B                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-A
           MOVE WS-IN TO WS-B
           IF WS-B = 0
              GOBACK
           END-IF
           IF WS-A + WS-B > 10
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-A + 1)
           GOBACK.
