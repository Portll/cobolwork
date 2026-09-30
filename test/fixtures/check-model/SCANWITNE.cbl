       IDENTIFICATION DIVISION.
       PROGRAM-ID. SCANWITNE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(4).
       01 I                   PIC 9(4) COMP.
       01 K                   PIC 9(4) COMP.
       01 WS-OUT              PIC X(80).
       01 TERM-DATA.
          05 TERM-LINES       PIC X(80) OCCURS 24.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT TERM-DATA FROM COMMAND-LINE
           PERFORM VARYING K FROM 1 BY 1 UNTIL K > 24
              IF TERM-LINES(K) NOT = SPACES
                 PERFORM VARYING I FROM LENGTH OF TERM-LINES(1) BY -1
                         UNTIL I < 1 OR TERM-LINES(K)(I:1) NOT = SPACES
                 END-PERFORM
                 MOVE TERM-LINES(K)(1:I) TO WS-OUT
              END-IF
           END-PERFORM
           GOBACK.
       OTHER-PARA.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO I.
