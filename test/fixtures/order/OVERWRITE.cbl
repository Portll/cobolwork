       IDENTIFICATION DIVISION.
       PROGRAM-ID. OVERWRITE.
      * The input reaches the command field, which is refilled with a
      * literal before the command runs.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(8).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-CMD
           DISPLAY WS-CMD
           MOVE 'LS' TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
