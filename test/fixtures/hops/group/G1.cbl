       IDENTIFICATION DIVISION.
       PROGRAM-ID. G1.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC.
          05 WS-IN         PIC X(80).
          05 WS-OTHER      PIC X(20).
       01 WS-OUT.
          05 WS-CMD        PIC X(80).
          05 WS-SPARE      PIC X(20).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-REC TO WS-OUT
           CALL 'SYSTEM' USING WS-CMD
           GOBACK.
