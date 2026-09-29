       IDENTIFICATION DIVISION.
       PROGRAM-ID. AROUND.
      * The shortest route to the command passes a checked field; a
      * longer one goes around it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(80).
       01 WS-A                PIC X(80).
       01 WS-B                PIC X(80).
       01 WS-C                PIC X(80).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-A
           IF WS-A IS NOT ALPHABETIC
              GOBACK
           END-IF
           MOVE WS-A TO WS-CMD
           MOVE WS-IN TO WS-B
           MOVE WS-B TO WS-C
           MOVE WS-C TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
