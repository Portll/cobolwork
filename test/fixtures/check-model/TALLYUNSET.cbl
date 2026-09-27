       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALLYUNSET.
      * The count is never set before the INSPECT adds to it, so what
      * it holds afterwards is not known.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-N                PIC 9(4) COMP.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           INSPECT WS-IN TALLYING WS-N FOR ALL '1'
           MOVE 'X' TO WS-ENTRY(WS-N)
           GOBACK.
