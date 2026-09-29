       IDENTIFICATION DIVISION.
       PROGRAM-ID. ODOCHECKED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-N                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 1 TO 100
                              DEPENDING ON WS-N.
       PROCEDURE DIVISION.
           ACCEPT WS-N FROM COMMAND-LINE
           IF WS-N > 100
              GOBACK
           END-IF
           MOVE SPACES TO WS-TABLE
           GOBACK.
