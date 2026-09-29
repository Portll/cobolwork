       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGCMOVED.
      * The item the flag is moved from is itself written, so it is no
      * constant and the flag says nothing.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9.
          88 I-VALID          VALUE 1, 2, 3.
       01 WS-NO               PIC X VALUE 'N'.
       01 WS-OK               PIC X VALUE 'Y'.
          88 OK-ON            VALUE 'Y'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 3.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           ACCEPT WS-NO FROM COMMAND-LINE
           PERFORM 1000-EDIT
           IF OK-ON
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
       1000-EDIT.
           IF NOT I-VALID
              MOVE WS-NO TO WS-OK
           END-IF.
