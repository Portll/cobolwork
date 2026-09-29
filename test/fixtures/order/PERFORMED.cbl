       IDENTIFICATION DIVISION.
       PROGRAM-ID. PERFORMED.
      * The check is a paragraph of its own, performed before the one
      * that uses the value.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(8).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
       MAIN-LINE.
           ACCEPT WS-IN FROM COMMAND-LINE
           PERFORM CHECK-IN
           PERFORM RUN-IT
           GOBACK.
       CHECK-IN.
           IF WS-IN IS NOT ALPHABETIC
              GOBACK
           END-IF.
       RUN-IT.
           MOVE WS-IN TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD.
