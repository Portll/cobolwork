       IDENTIFICATION DIVISION.
       PROGRAM-ID. LATERUSE.
      * The first use is guarded by its own condition; the second, after
      * it, is not.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I > 0 AND WS-I <= 10 AND WS-ENTRY(WS-I) = SPACES
              DISPLAY 'EMPTY'
           END-IF
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
