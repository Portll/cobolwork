       CBL SSRANGE
       IDENTIFICATION DIVISION.
       PROGRAM-ID. QTYSUM.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INFILE.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC.
          05 IN-NAME PIC X(10).
          05 IN-QTY  PIC 9(5).
          05 IN-IDX  PIC 9(2).
       WORKING-STORAGE SECTION.
       01 WS-TOTAL PIC 9(9) VALUE 0.
       01 WS-EOF PIC X VALUE 'N'.
       01 WS-TABLE.
          05 WS-SLOT PIC X(3) OCCURS 10 TIMES.
       PROCEDURE DIVISION.
           OPEN INPUT IN-FILE
           PERFORM UNTIL WS-EOF = 'Y'
              READ IN-FILE AT END MOVE 'Y' TO WS-EOF
              NOT AT END
                 ADD IN-QTY TO WS-TOTAL
                 MOVE 'ABC' TO WS-SLOT (IN-IDX)
              END-READ
           END-PERFORM
           CLOSE IN-FILE
           GOBACK.
