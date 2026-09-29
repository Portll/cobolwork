       IDENTIFICATION DIVISION.
       PROGRAM-ID. GOEXIT.
      * A range performed THRU its exit: a good index leaves for the
      * exit by GO TO, a bad one ends the run. The index is used after
      * the range returns.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IDX              PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-LINE.
           ACCEPT WS-IDX FROM COMMAND-LINE
           PERFORM EDIT-IDX THRU EDIT-IDX-EXIT
           MOVE 'X' TO WS-ENTRY(WS-IDX)
           GOBACK.
       EDIT-IDX.
           IF WS-IDX >= 1 AND WS-IDX <= 10
              GO TO EDIT-IDX-EXIT
           END-IF
           DISPLAY 'BAD INDEX'
           GOBACK.
       EDIT-IDX-EXIT.
           EXIT.
