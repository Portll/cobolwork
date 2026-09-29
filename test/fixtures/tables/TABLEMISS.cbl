       IDENTIFICATION DIVISION.
       PROGRAM-ID. TABLEMISS.
      * Input fills the field after the table in the same group; no
      * element of the table holds any of it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC.
          05 WS-PART          PIC X(5) OCCURS 4.
          05 WS-AFTER         PIC X(10).
       01 WS-CMD              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-AFTER FROM COMMAND-LINE
           MOVE WS-PART(1) TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
