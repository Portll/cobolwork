       IDENTIFICATION DIVISION.
       PROGRAM-ID. LATE.
      * The same check, performed after the value is used.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(8).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
       MAIN-LINE.
           ACCEPT WS-IN FROM COMMAND-LINE
           PERFORM RUN-IT
           PERFORM CHECK-IN
           GOBACK.
       CHECK-IN.
           IF WS-IN IS NOT ALPHABETIC
              GOBACK
           END-IF.
       RUN-IT.
           MOVE WS-IN TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD.
