       IDENTIFICATION DIVISION.
       PROGRAM-ID. RETRY.
      * Input is asked for until it is a number, then computed with.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-QTY              PIC 9(5).
       01 WS-TOTAL            PIC 9(7).
       PROCEDURE DIVISION.
           ACCEPT WS-QTY FROM COMMAND-LINE
           PERFORM UNTIL WS-QTY IS NUMERIC
              ACCEPT WS-QTY FROM COMMAND-LINE
           END-PERFORM
           COMPUTE WS-TOTAL = WS-QTY * 10
           GOBACK.
