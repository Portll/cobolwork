       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLYNEXT.
      * NEXT SENTENCE can skip the MOVE and enter the INSPECT's sentence
      * with the count as it was.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-OUT              PIC X(10).
       01 WS-LEN              PIC 9(4) COMP.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           IF WS-IN = SPACES
              NEXT SENTENCE
           END-IF
           MOVE ZERO TO WS-LEN.
           INSPECT WS-IN TALLYING WS-LEN
               FOR CHARACTERS BEFORE INITIAL SPACE.
           IF WS-LEN > 0
              MOVE WS-IN(1:WS-LEN) TO WS-OUT
           END-IF
           GOBACK.
