       CBL SSRANGE
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CHECKED.
      * Compiled with SSRANGE: an index out of range abends rather than
      * overwriting the storage beside the table.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IDX              PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IDX FROM COMMAND-LINE
           MOVE 'X' TO WS-ENTRY(WS-IDX)
           GOBACK.
