       IDENTIFICATION DIVISION.
       PROGRAM-ID. DISPATCH.
      * The same EVALUATE only chooses what else to do; every name,
      * known or not, goes on to the command.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REPORT           PIC X(8).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-REPORT FROM COMMAND-LINE
           EVALUATE WS-REPORT
              WHEN 'DAILY'
              WHEN 'MONTHLY'
                 DISPLAY 'KNOWN REPORT'
              WHEN OTHER
                 DISPLAY 'UNKNOWN REPORT'
           END-EVALUATE
           MOVE WS-REPORT TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
