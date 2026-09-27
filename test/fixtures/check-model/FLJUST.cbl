       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLJUST.
      * A right-justified flag set to 'Y' holds ' Y'.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-ERR              PIC XX JUSTIFIED RIGHT VALUE SPACES.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I > 10
              MOVE 'Y' TO WS-ERR
           END-IF
           IF WS-ERR NOT = 'Y'
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
