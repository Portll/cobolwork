       IDENTIFICATION DIVISION.
       PROGRAM-ID. ORGUARD.
      * The element is read only once both tests before it are false.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I < 1 OR WS-I > 10 OR WS-ENTRY(WS-I) = SPACES
              DISPLAY 'NO ENTRY'
           END-IF
           GOBACK.
