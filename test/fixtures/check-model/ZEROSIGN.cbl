       IDENTIFICATION DIVISION.
       PROGRAM-ID. ZEROSIGN.
      * A signed field not equal to zero may still be negative.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC S99.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I = ZERO OR WS-I > 10
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
