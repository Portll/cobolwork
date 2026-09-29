       IDENTIFICATION DIVISION.
       PROGRAM-ID. REFMOD.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LEN              PIC 9(4).
       01 WS-BUF              PIC X(20).
       01 WS-OUT              PIC X(80).
       PROCEDURE DIVISION.
           ACCEPT WS-LEN FROM COMMAND-LINE
           MOVE WS-BUF(1:WS-LEN) TO WS-OUT
           GOBACK.
