       IDENTIFICATION DIVISION.
       PROGRAM-ID. GUARDINC.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(4).
       01 WS-SUB              PIC S9(4) COMP.
       01 WS-TOTAL            PIC 9(9).
       01 WS-TABLE.
          05 WS-AMT           PIC 9(7) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE 1 TO WS-SUB
           PERFORM ADD-ONE UNTIL WS-IN = SPACES
           GOBACK.
       ADD-ONE.
           ADD WS-AMT (WS-SUB) TO WS-TOTAL
           IF WS-SUB < 10
               ADD 1 TO WS-SUB
           END-IF
           ACCEPT WS-IN FROM COMMAND-LINE.
       OTHER-PARA.
           MOVE WS-IN TO WS-SUB.
