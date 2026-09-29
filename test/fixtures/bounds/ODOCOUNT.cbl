       IDENTIFICATION DIVISION.
       PROGRAM-ID. ODOCOUNT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-CNT              PIC 9(4).
       01 WS-LIST.
          05 WS-ITEM          PIC X(8) OCCURS 1 TO 50
                              DEPENDING ON WS-CNT.
       01 WS-COPY             PIC X(400).
       PROCEDURE DIVISION.
           ACCEPT WS-CNT FROM COMMAND-LINE
           MOVE WS-LIST TO WS-COPY
           GOBACK.
