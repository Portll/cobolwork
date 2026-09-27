       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLYNEXT.
      * NEXT SENTENCE can skip the MOVE and enter the INSPECT's sentence
      * with the count as it was.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-N                PIC 9(4) COMP.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-IN = SPACES
              NEXT SENTENCE
           END-IF
           MOVE 1 TO WS-N.
           INSPECT WS-IN TALLYING WS-N FOR ALL '1'.
           MOVE 'X' TO WS-ENTRY(WS-N)
           GOBACK.
