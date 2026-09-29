       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILEIDX.
      * A subscript taken from a file record: the ordinary shape of
      * batch COBOL, and not reported.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INDD.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC.
          05 IN-MONTH         PIC 99.
          05 IN-AMOUNT        PIC 9(7).
       WORKING-STORAGE SECTION.
       01 WS-TOTALS.
          05 WS-TOTAL         PIC 9(9) OCCURS 12.
       PROCEDURE DIVISION.
           OPEN INPUT IN-FILE
           READ IN-FILE
           ADD IN-AMOUNT TO WS-TOTAL(IN-MONTH)
           CLOSE IN-FILE
           GOBACK.
