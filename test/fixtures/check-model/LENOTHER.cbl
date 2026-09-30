       IDENTIFICATION DIVISION.
       PROGRAM-ID. LENOTHER.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(512).
       01 WS-STR              PIC X(256).
       01 WS-LEN              PIC 9(4) COMP-5.
       01 WS-J                PIC 9(4) COMP-5.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-STR
           MOVE FUNCTION LENGTH(
               FUNCTION TRIM(WS-IN))
               TO WS-LEN
           PERFORM VARYING WS-J FROM 1 BY 1
               UNTIL WS-J > WS-LEN - 1
               IF WS-STR(WS-J:2) = " ="
                   MOVE ";" TO WS-STR(WS-J:1)
               END-IF
           END-PERFORM
           GOBACK.
       OTHER-PARA.
           MOVE WS-IN(1:3) TO WS-J.
