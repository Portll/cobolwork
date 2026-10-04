       IDENTIFICATION DIVISION.
       PROGRAM-ID. ROUTES.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(40).
       01 WS-A                PIC X(40).
       01 WS-B                PIC X(40).
       01 WS-CMD              PIC X(40).
       01 WS-LOG              PIC X(40).
       01 WS-FLAG             PIC X.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-LOG
           IF WS-FLAG = 'Y'
               MOVE WS-IN TO WS-A
               MOVE WS-A TO WS-CMD
           ELSE
               MOVE WS-IN TO WS-B
               MOVE WS-B TO WS-CMD
           END-IF
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
