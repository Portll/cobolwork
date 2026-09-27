       IDENTIFICATION DIVISION.
       PROGRAM-ID. FLGROUP.
      * The flag is overwritten through a REDEFINES of its record.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-FLAGS.
          05 WS-ERR           PIC X VALUE 'N'.
          05 FILLER           PIC X(9).
       01 WS-FLAGS-X REDEFINES WS-FLAGS PIC X(10).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           IF WS-I > 10
              MOVE 'Y' TO WS-ERR
           END-IF
           MOVE 'N' TO WS-FLAGS-X
           IF WS-ERR = 'N'
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-IF
           GOBACK.
