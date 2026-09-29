       IDENTIFICATION DIVISION.
       PROGRAM-ID. PERFFLAG.
      * A performed section sets the flag on each bad case, in separate
      * paragraphs; the use is under the flag being clear.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-ERR              PIC X VALUE 'N'.
          88 ERR-ON           VALUE 'Y'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN SECTION.
           ACCEPT WS-I FROM COMMAND-LINE
           PERFORM CHK-SEC
           IF NOT ERR-ON
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
       CHK-SEC SECTION.
       CHK-1.
           IF WS-I < 1
              MOVE 'Y' TO WS-ERR
           END-IF.
       CHK-2.
           IF WS-I > 10
              MOVE 'Y' TO WS-ERR
           END-IF.
