       IDENTIFICATION DIVISION.
       PROGRAM-ID. MONTOT.
      * A month number read from a file picks the monthly total: the
      * ordinary shape of batch COBOL, and not input from outside.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT TXN-FILE ASSIGN TO TXNIN.
       DATA DIVISION.
       FILE SECTION.
       FD TXN-FILE.
       01 TXN-REC.
          05 TXN-MONTH        PIC 99.
          05 TXN-AMOUNT       PIC 9(7).
       WORKING-STORAGE SECTION.
       01 WS-TOTALS.
          05 WS-TOTAL         PIC 9(9) OCCURS 12.
       PROCEDURE DIVISION.
           OPEN INPUT TXN-FILE
           READ TXN-FILE
           ADD TXN-AMOUNT TO WS-TOTAL(TXN-MONTH)
           CLOSE TXN-FILE
           GOBACK.
