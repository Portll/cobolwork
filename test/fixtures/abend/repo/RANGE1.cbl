       CBL SSRANGE
       IDENTIFICATION DIVISION.
       PROGRAM-ID. RANGE1.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(4).
       01 WS-I                PIC 9(4).
       01 WS-T.
          05 WS-E             PIC X OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN
           MOVE WS-IN TO WS-I
           MOVE 'X' TO WS-E(WS-I)
           GOBACK.
