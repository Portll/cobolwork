       IDENTIFICATION DIVISION.
       PROGRAM-ID. LIBADD.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INDD.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC.
          05 IN-QTY           PIC 9(5).
       WORKING-STORAGE SECTION.
       01 WS-TOTAL            PIC 9(7) VALUE 0.
       PROCEDURE DIVISION.
           OPEN INPUT IN-FILE
           READ IN-FILE
               NOT AT END
                   COPY ADDQTY.
           END-READ
           CLOSE IN-FILE
           GOBACK.
