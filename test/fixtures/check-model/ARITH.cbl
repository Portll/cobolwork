       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARITH.
      * The first arithmetic use in the source is dead, the second is
      * under a NUMERIC test, the third is not.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-N                PIC 9(4).
       01 WS-T                PIC 9(6).
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-N FROM COMMAND-LINE
           GO TO LIVE-PARA.
       DEAD-PARA.
           ADD WS-N TO WS-T.
       LIVE-PARA.
           IF WS-N IS NUMERIC
              ADD WS-N TO WS-T
           END-IF
           COMPUTE WS-T = WS-T + WS-N
           GOBACK.
