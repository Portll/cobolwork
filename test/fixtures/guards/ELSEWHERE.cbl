       IDENTIFICATION DIVISION.
       PROGRAM-ID. ELSEWHERE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(80).
       01 WS-CMD              PIC X(80).
       01 WS-OTHER            PIC X(8).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-OTHER IS NOT ALPHABETIC
              GOBACK
           END-IF
           MOVE WS-IN TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
