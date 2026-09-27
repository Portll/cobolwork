       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGRESET.
      * The flag is cleared after the bound set it, so it says nothing
      * about the index by the time it is tested.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-ERR              PIC X VALUE 'N'.
          88 ERR-ON           VALUE 'Y'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I < 1 OR WS-I > 10
              MOVE 'Y' TO WS-ERR
           END-IF
           MOVE 'N' TO WS-ERR
           IF NOT ERR-ON
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
