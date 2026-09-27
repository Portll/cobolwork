       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGMOVED.
      * The index changes after the bound, so the flag no longer
      * speaks for it.
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
           ADD 5 TO WS-I
           IF NOT ERR-ON
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
