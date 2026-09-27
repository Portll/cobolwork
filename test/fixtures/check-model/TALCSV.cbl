       IDENTIFICATION DIVISION.
       PROGRAM-ID. TALCSV.
      * Count the commas in an 80-byte input line and use the count to
      * pick one of 10 fields.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LINE             PIC X(80).
       01 WS-N                PIC 9(4) COMP.
       01 WS-FIELDS.
          05 WS-FIELD         PIC X(8) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-LINE FROM COMMAND-LINE
           MOVE 0 TO WS-N
           INSPECT WS-LINE TALLYING WS-N FOR ALL ','
           MOVE 'LAST' TO WS-FIELD(WS-N)
           GOBACK.
