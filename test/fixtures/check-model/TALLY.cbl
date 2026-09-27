       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLY.
      * A count set to zero and tallied over a 10-byte field is at most
      * 10, however the input reads.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-OUT              PIC X(10).
       01 WS-LEN              PIC 9(4) COMP.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE.
           MOVE ZERO TO WS-LEN.
           INSPECT WS-IN TALLYING WS-LEN
               FOR CHARACTERS BEFORE INITIAL SPACE.
           IF WS-LEN > 0
              MOVE WS-IN(1:WS-LEN) TO WS-OUT
           END-IF
           GOBACK.
