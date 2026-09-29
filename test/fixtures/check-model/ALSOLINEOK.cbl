       IDENTIFICATION DIVISION.
       PROGRAM-ID. ALSOLINEOK.
      * Both indexes are bounded before either line reads them, so the second line, left out
      * of the report as a use of the same indexes, lowers nothing.
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
           IF WS-I < 1 OR WS-I > 10 OR WS-J < 1 OR WS-J > 10
              GOBACK
           END-IF
           MOVE WS-T1(WS-I:1) TO WS-T2(WS-J:1)
           MOVE WS-T2(WS-I:1) TO WS-T1(WS-J:1)
           GOBACK.
