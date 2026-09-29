       IDENTIFICATION DIVISION.
       PROGRAM-ID. CPAREN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-MODE             PIC X.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           ACCEPT WS-MODE FROM COMMAND-LINE
           IF (WS-MODE = 'A' OR WS-I <= 10) AND WS-ENTRY(WS-I) = 'X'
              DISPLAY 'ONE'
           END-IF
           GOBACK.
