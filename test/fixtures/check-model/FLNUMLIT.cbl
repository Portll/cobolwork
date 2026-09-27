       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLNUMLIT.
      * A two-digit numeric flag set to 1 holds 01, which is not equal
      * to the alphanumeric literal '1'.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-RC               PIC 99 VALUE 0.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I > 10
              MOVE 1 TO WS-RC
           END-IF
           IF WS-RC NOT = '1'
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
