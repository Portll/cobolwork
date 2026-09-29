       IDENTIFICATION DIVISION.
       PROGRAM-ID. ROUTED.
      * Compares the input with a value to choose a branch, and runs it
      * in the other one.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(80).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-IN = "@DEFAULT"
              MOVE "ls" TO WS-CMD
           ELSE
              MOVE WS-IN TO WS-CMD
           END-IF
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
