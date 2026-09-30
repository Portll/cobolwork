       IDENTIFICATION DIVISION.
       PROGRAM-ID. SPANLIFTOVER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(256).
       01 WS-STR              PIC X(256).
       01 WS-OUT              PIC X(256).
       01 WS-IDX              PIC 9(4) COMP-5.
       01 WS-N                PIC 9(4) COMP-5.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN(1:3) TO WS-IDX
           MOVE WS-IN(4:3) TO WS-N
           IF WS-IDX < 1 OR WS-N < 1 OR WS-N > 256
               GOBACK
           END-IF
           IF WS-IDX + 4 + WS-N > 256
               GOBACK
           END-IF
           ADD 6 TO WS-IDX
           MOVE WS-STR(WS-IDX:WS-N) TO WS-OUT
           GOBACK.
