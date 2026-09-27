       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALREDEF.
      * A REDEFINES of the count is written between the MOVE and the
      * INSPECT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-OUT              PIC X(10).
       01 WS-N                PIC 9(4).
       01 WS-NX REDEFINES WS-N PIC X(4).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE 0 TO WS-N
           ACCEPT WS-NX FROM COMMAND-LINE
           INSPECT WS-IN TALLYING WS-N FOR ALL 'A'
           IF WS-N > 0
              MOVE WS-IN(1:WS-N) TO WS-OUT
           END-IF
           GOBACK.
