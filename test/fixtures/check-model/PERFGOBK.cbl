       IDENTIFICATION DIVISION.
       PROGRAM-ID. PERFGOBK.
      * The performed paragraph leaves the run on a bad index, so the
      * use after the PERFORM sees only an index within the table.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           PERFORM 1000-CHECK
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
       1000-CHECK.
           IF WS-I < 1 OR WS-I > 10
              GOBACK
           END-IF.
