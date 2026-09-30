       IDENTIFICATION DIVISION.
       PROGRAM-ID. GOTOBARE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(4).
       01 SUB-25              PIC S9(4) COMP.
       01 WS-RUN              PIC 9(9).
       01 WS-TABLE.
          05 FL-AMT           PIC 9(7) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-IN FROM COMMAND-LINE
           PERFORM WFCT-155 THRU WFCT-157
           GOBACK.
       WFCT-155.
           MOVE 1 TO SUB-25.
           MOVE 0 TO WS-RUN.
       WFCT-156.
           ADD FL-AMT (SUB-25) TO WS-RUN.
           IF WS-IN = "X"
              ADD 1 TO SUB-25
              GO TO WFCT-156.
           IF SUB-25 < 10
              ADD 1 TO SUB-25
              GO TO WFCT-156.
       WFCT-157.
           EXIT.
       OTHER-PARA.
           MOVE WS-IN TO SUB-25.
