       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGGED.
      * A failed check sets a flag, and the flag is tested later. The
      * check ran first; whether the flag stops the value is not read.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(8).
       01 WS-ERR              PIC X VALUE 'N'.
          88 ERR-ON           VALUE 'Y'.
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-IN IS NOT NUMERIC
              MOVE 'Y' TO WS-ERR
           END-IF
           IF NOT ERR-ON
              MOVE WS-IN TO WS-CMD
              CALL 'SYSTEM' USING WS-CMD
           END-IF
           GOBACK.
