       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLY.
      * One more than the count of ones in nine bytes picks one of ten
      * slots: the count starts at 1 and ends at most at 10.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-N                PIC 9(4) COMP.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE.
           MOVE 1 TO WS-N.
           INSPECT WS-IN TALLYING WS-N FOR ALL '1'.
           MOVE 'X' TO WS-ENTRY(WS-N)
           GOBACK.
