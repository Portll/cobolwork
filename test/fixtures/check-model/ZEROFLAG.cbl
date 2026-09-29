       IDENTIFICATION DIVISION.
       PROGRAM-ID. ZEROFLAG.
      * A zero option and a high one set the error flag; the use is
      * where the flag is off.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-OPTION           PIC 9(2).
       01 WS-ERR-FLG          PIC X VALUE 'N'.
          88 ERR-FLG-ON       VALUE 'Y'.
          88 ERR-FLG-OFF      VALUE 'N'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-OPTION FROM COMMAND-LINE
           IF WS-OPTION IS NOT NUMERIC OR WS-OPTION > 10
              SET ERR-FLG-ON TO TRUE
           END-IF
           IF WS-OPTION = ZEROS
              SET ERR-FLG-ON TO TRUE
           END-IF
           IF NOT ERR-FLG-ON
              MOVE 'X' TO WS-ENTRY(WS-OPTION)
           END-IF
           GOBACK.
