       IDENTIFICATION DIVISION.
       PROGRAM-ID. DCLOOP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 SUB-5               PIC S9(4) COMP.
       01 SUB-6               PIC S9(4) COMP.
       01 WS-TABLE.
          05 WS-DC            PIC X OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-IN FROM COMMAND-LINE
           PERFORM DC-000 THRU DC-900
           GOBACK.
       DC-000.
           MOVE 1 TO SUB-5 SUB-6.
       DC-060.
           IF WS-IN (SUB-5:1) NOT = "/"
              IF SUB-6 = 3 OR = 6
                MOVE "/" TO WS-DC (SUB-6)
                ADD 1 TO SUB-6
                MOVE WS-IN (SUB-5:1) TO WS-DC (SUB-6)
                GO TO DC-065.
           MOVE WS-IN (SUB-5:1) TO WS-DC (SUB-6).
       DC-065.
           ADD 1 TO SUB-5 SUB-6.
           IF SUB-6 < 11
              GO TO DC-060.
       DC-900.
           EXIT.
       OTHER-PARA.
           MOVE WS-IN TO SUB-6.
