       IDENTIFICATION DIVISION.
       PROGRAM-ID. ZEROALPHA.
      * Text that is not '0' may be anything, and is no number.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC X(2).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I = ZERO OR WS-I > 10
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
