       IDENTIFICATION DIVISION.
       PROGRAM-ID. VALMOVED.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-MAX              PIC 99 VALUE 20.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 20.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           MOVE 90 TO WS-MAX
           IF WS-I < 1 OR WS-I > WS-MAX
              GOBACK
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
