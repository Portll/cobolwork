       IDENTIFICATION DIVISION.
       PROGRAM-ID. PRESENCE.
      * Tests only that the input was given, not what it holds.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(80).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-IN = SPACES OR WS-CMD = LOW-VALUES
              GOBACK
           END-IF
           MOVE WS-IN TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
