       IDENTIFICATION DIVISION.
       PROGRAM-ID. PERFRESET.
      * A second performed paragraph clears the flag between the check
      * and the use.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-ERR              PIC X VALUE 'N'.
          88 ERR-ON           VALUE 'Y'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           PERFORM 1000-CHECK
           PERFORM 2000-CLEAR
           IF NOT ERR-ON
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
       1000-CHECK.
           IF WS-I < 1 OR WS-I > 10
              MOVE 'Y' TO WS-ERR
           END-IF.
       2000-CLEAR.
           MOVE 'N' TO WS-ERR.
