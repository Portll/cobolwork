       IDENTIFICATION DIVISION.
       PROGRAM-ID. ANDLATE.
      * The element is read before the bound is tested.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-ENTRY(WS-I) = SPACES AND WS-I <= 10
              DISPLAY 'EMPTY'
           END-IF
           GOBACK.
