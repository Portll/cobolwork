       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONSTREF.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-I                PIC 9(4).
       01 WS-X                PIC X(10).
       01 WS-Y                PIC X(10).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-I
           IF WS-IN = 'A'
              MOVE 7 TO WS-I
           ELSE
              MOVE 3 TO WS-I
           END-IF
           MOVE WS-Y TO WS-X(WS-I:)
           GOBACK.
