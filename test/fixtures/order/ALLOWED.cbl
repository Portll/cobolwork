       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALLOWED.
      * The report name is one of two, or the program ends.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REPORT           PIC X(8).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-REPORT FROM COMMAND-LINE
           EVALUATE WS-REPORT
              WHEN 'DAILY'
              WHEN 'MONTHLY'
                 CONTINUE
              WHEN OTHER
                 DISPLAY 'UNKNOWN REPORT'
                 GOBACK
           END-EVALUATE
           MOVE WS-REPORT TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
