       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONSTBIG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-I                PIC 9(4).
       01 WS-X                PIC X(10).
       01 WS-Y                PIC X(10).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-I
           MOVE 12 TO WS-I
           MOVE WS-Y TO WS-X(WS-I:)
           GOBACK.
