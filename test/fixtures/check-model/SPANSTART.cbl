       IDENTIFICATION DIVISION.
       PROGRAM-ID. SPANSTART.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(256).
       01 WS-STR              PIC X(256).
       01 WS-J                PIC 9(4) COMP-5.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN(1:3) TO WS-J
           IF WS-J >= 1 AND WS-J <= 256
               MOVE "ABC" TO WS-STR(5:WS-J)
           END-IF
           GOBACK.
