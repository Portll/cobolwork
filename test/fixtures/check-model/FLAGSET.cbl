       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGSET.
      * A bound that fails sets a flag, and the index is used only
      * where the flag is not set.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-ERR              PIC X VALUE 'N'.
          88 ERR-ON           VALUE 'Y'.
          88 ERR-OFF          VALUE 'N'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           SET ERR-OFF TO TRUE
           IF WS-I < 1 OR WS-I > 10
              SET ERR-ON TO TRUE
              DISPLAY 'BAD INDEX'
           END-IF
           IF NOT ERR-ON
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
