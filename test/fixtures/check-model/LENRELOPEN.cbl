       IDENTIFICATION DIVISION.
       PROGRAM-ID. LENRELOPEN.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(256).
       01 WS-STR              PIC X(256).
       01 WS-OUT              PIC X(256).
       01 WS-LEN              PIC 9(4) COMP-5.
       01 WS-IDX              PIC 9(4) COMP-5.
       01 WS-N                PIC 9(4) COMP-5.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-STR
           MOVE FUNCTION LENGTH(FUNCTION TRIM(WS-STR)) TO WS-LEN
           MOVE WS-IN(1:3) TO WS-IDX
           IF WS-IDX >= 1 AND WS-IDX <= 256
               COMPUTE WS-N = WS-LEN - WS-IDX + 1
               MOVE WS-STR(WS-IDX:WS-N) TO WS-OUT
           END-IF
           GOBACK.
