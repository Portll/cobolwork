       IDENTIFICATION DIVISION.
       PROGRAM-ID. G1.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REQUEST.
          05 WS-VERB        PIC X(8) VALUE 'ls '.
          05 WS-ARG         PIC X(72).
       01 WS-CMD            PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-ARG FROM COMMAND-LINE
           MOVE WS-REQUEST TO WS-CMD
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
