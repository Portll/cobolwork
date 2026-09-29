       IDENTIFICATION DIVISION.
       PROGRAM-ID. PROMPTS.
      * One buffer holds the answer to two prompts. It is tested as a
      * number for the first and used untested for the second.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-ANSWER           PIC X(8).
       01 WS-STEP             PIC X.
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
       MAIN-LINE.
           ACCEPT WS-STEP FROM ENVIRONMENT
           ACCEPT WS-ANSWER FROM COMMAND-LINE
           IF WS-STEP = '1'
              IF WS-ANSWER IS NOT NUMERIC
                 GOBACK
              END-IF
           END-IF
           MOVE WS-ANSWER TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
