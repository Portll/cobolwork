       IDENTIFICATION DIVISION.
       PROGRAM-ID. GMN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC.
          05 WS-A          PIC X(8).
          05 WS-B          PIC X(8).
       01 WS-OUT.
          05 WS-OUT-A      PIC X(8).
          05 WS-OUT-B      PIC X(8).
       PROCEDURE DIVISION.
           ACCEPT WS-A FROM COMMAND-LINE.
           MOVE WS-REC TO WS-OUT.
           CALL 'SYSTEM' USING WS-OUT-B.
           STOP RUN.
