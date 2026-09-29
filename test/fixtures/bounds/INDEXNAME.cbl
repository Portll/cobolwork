       IDENTIFICATION DIVISION.
       PROGRAM-ID. INDEXNAME.
      * Input reaches a table through its INDEXED BY name.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-N                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10 INDEXED BY TX.
       PROCEDURE DIVISION.
           ACCEPT WS-N FROM COMMAND-LINE
           SET TX TO WS-N
           MOVE 'X' TO WS-ENTRY(TX)
           GOBACK.
