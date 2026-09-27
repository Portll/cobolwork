       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLYUNSET.
      * The count is never set before the INSPECT adds to it, so what
      * it holds afterwards is not known.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-OUT              PIC X(10).
       01 WS-LEN              PIC 9(4) COMP.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           INSPECT WS-IN TALLYING WS-LEN
               FOR CHARACTERS BEFORE INITIAL SPACE
           IF WS-LEN > 0
              MOVE WS-IN(1:WS-LEN) TO WS-OUT
           END-IF
           GOBACK.
