       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALSOLINE.
      * WS-J is read unchecked at the first move and again beside the checked WS-I; the second
      * line is only as checked as its least checked index.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-A                PIC 9(4).
       01 WS-I                PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-T1               PIC X(10).
       01 WS-T2               PIC X(10).
       PROCEDURE DIVISION.
           ACCEPT WS-A FROM COMMAND-LINE
           MOVE WS-A TO WS-I
           MOVE WS-A TO WS-J
           MOVE 'X' TO WS-T2(WS-J:1)
           IF WS-I > 10
              GOBACK
           END-IF
           MOVE WS-T1(WS-I:1) TO WS-T2(WS-J:1)
           GOBACK.
