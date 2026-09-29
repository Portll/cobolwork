       IDENTIFICATION DIVISION.
       PROGRAM-ID. CUSTTOT.
      * Totals a customer's orders into a field that neither this
      * program nor the copybook it reads declares.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT ORDER-FILE ASSIGN TO ORDERS
               FILE STATUS IS WS-ORDER-STATUS.
       DATA DIVISION.
       FILE SECTION.
       FD  ORDER-FILE.
           COPY CUSTORD.
       WORKING-STORAGE SECTION.
       01  WS-ORDER-STATUS         PIC XX.
           88  WS-ORDER-EOF        VALUE '10'.
       PROCEDURE DIVISION.
           OPEN INPUT ORDER-FILE
           PERFORM UNTIL WS-ORDER-EOF
               READ ORDER-FILE
                   AT END CONTINUE
                   NOT AT END ADD ORD-AMOUNT TO WS-CUSTOMER-TOTAL
               END-READ
           END-PERFORM
           CLOSE ORDER-FILE
           DISPLAY 'CUSTOMER TOTAL ' WS-CUSTOMER-TOTAL
           GOBACK.
