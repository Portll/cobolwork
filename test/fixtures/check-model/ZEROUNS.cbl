       IDENTIFICATION DIVISION.
       PROGRAM-ID. ZEROUNS.
      * An unsigned integer that is not zero is at least 1.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 99.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I = ZERO OR WS-I > 10
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
