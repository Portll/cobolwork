       IDENTIFICATION DIVISION.
       PROGRAM-ID. ODOUNCHECKED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-N                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 1 TO 100
                              DEPENDING ON WS-N.
       PROCEDURE DIVISION.
           ACCEPT WS-N FROM COMMAND-LINE
           MOVE SPACES TO WS-TABLE
           GOBACK.
