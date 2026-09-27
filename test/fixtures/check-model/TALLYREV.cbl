       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLYREV.
      * Trailing spaces counted over the reversed field, from a count
      * INITIALIZE set to zero, and the length taken from what is left.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-OUT              PIC X(10).
       01 WS-BLANKS           PIC 9(2).
       01 WS-LEN              PIC 9(2).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-IN NOT = SPACES
              INITIALIZE WS-BLANKS
              INSPECT FUNCTION REVERSE(WS-IN)
                 TALLYING WS-BLANKS FOR LEADING SPACES
              COMPUTE WS-LEN = 10 - WS-BLANKS
              MOVE WS-IN(1:WS-LEN) TO WS-OUT
           END-IF
           GOBACK.
