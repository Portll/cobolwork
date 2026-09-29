       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGCONST.
      * The bad case moves a constant item to the flag; the check and
      * the flag are in a performed paragraph.
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
           PERFORM 1000-EDIT
           IF OK-ON
              PERFORM 2000-USE
           END-IF
           GOBACK.
       1000-EDIT.
           IF NOT I-VALID
              MOVE WS-NO TO WS-OK
           END-IF.
       2000-USE.
           MOVE 'X' TO WS-ENTRY(WS-I).
