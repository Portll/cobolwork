       IDENTIFICATION DIVISION.
       PROGRAM-ID. EXPRCHUNK.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-LEN              PIC 9(9) COMP-5.
       01 WS-USED             PIC 9(9) COMP-5.
       01 WS-SRC              PIC X(10).
       01 WS-DST              PIC X(10).
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-LEN
           IF WS-USED + WS-LEN > 10
              GOBACK
           END-IF
           IF WS-LEN = 0
              GOBACK
           END-IF
           MOVE WS-SRC(1:WS-LEN) TO WS-DST(1:WS-LEN)
           GOBACK.
