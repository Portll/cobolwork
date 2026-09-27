       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLAGEVAL.
      * Each failing branch of an EVALUATE moves 'Y' to the flag; the
      * use is under a test that the flag is still 'N'.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-ERR              PIC X.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           MOVE 'N' TO WS-ERR
           EVALUATE TRUE
              WHEN WS-I NOT NUMERIC
                 MOVE 'Y' TO WS-ERR
              WHEN WS-I < 1
                 MOVE 'Y' TO WS-ERR
              WHEN WS-I > 10
                 MOVE 'Y' TO WS-ERR
              WHEN OTHER
                 CONTINUE
           END-EVALUATE
           IF WS-ERR = 'N'
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
