       IDENTIFICATION DIVISION.
       PROGRAM-ID. CNOTOR.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF NOT WS-I > 10 OR WS-ENTRY(WS-I) = 'X'
              DISPLAY 'ONE'
           END-IF
           GOBACK.
