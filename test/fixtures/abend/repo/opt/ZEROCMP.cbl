       IDENTIFICATION DIVISION.
       PROGRAM-ID. ZEROCMP.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INFILE.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC.
          05 IN-QTY  PIC 9(5).
          05 IN-RATE PIC 9(3).
       WORKING-STORAGE SECTION.
       01 WS-TOTAL PIC 9(9) VALUE 0.
       PROCEDURE DIVISION.
           OPEN INPUT IN-FILE
           READ IN-FILE
              NOT AT END
                 IF IN-QTY NOT = ZERO
                    ADD IN-QTY TO WS-TOTAL
                 END-IF
                 ADD IN-RATE TO WS-TOTAL
           END-READ
           CLOSE IN-FILE
           GOBACK.
