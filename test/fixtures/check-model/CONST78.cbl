       IDENTIFICATION DIVISION.
       PROGRAM-ID. CONST78.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       78 MAXOPZ              VALUE 20.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 20.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I < 1 OR WS-I > MAXOPZ
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
