       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALZERO.
      * A tally of zero used as a reference-modification start writes
      * the byte before the field.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-OUT              PIC X(10).
       01 WS-N                PIC 9(4) COMP.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE 0 TO WS-N
           INSPECT WS-IN TALLYING WS-N FOR LEADING SPACES
           MOVE '*' TO WS-OUT(WS-N:1)
           GOBACK.
