       IDENTIFICATION DIVISION.
       PROGRAM-ID. ABEND7.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INDD.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC              PIC X(10).
       WORKING-STORAGE SECTION.
       01 WS-QTY              PIC 9(5).
       01 WS-TOTAL            PIC 9(7) VALUE 0.
       PROCEDURE DIVISION.
           OPEN INPUT IN-FILE
           READ IN-FILE
           MOVE IN-REC(1:5) TO WS-QTY
           ADD WS-QTY TO WS-TOTAL
           DISPLAY WS-TOTAL
           CLOSE IN-FILE
           GOBACK.
