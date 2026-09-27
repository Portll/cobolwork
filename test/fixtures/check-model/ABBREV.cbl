       IDENTIFICATION DIVISION.
       PROGRAM-ID. ABBREV.
      * OR 'B' carries the subject: the element is read a second time
      * when the first half is false, whatever the bound said.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I <= 10 AND WS-ENTRY(WS-I) = 'A' OR 'B'
              DISPLAY 'A OR B'
           END-IF
           GOBACK.
