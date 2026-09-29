       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPMOVE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 10
              ACCEPT WS-J FROM COMMAND-LINE
              MOVE WS-J TO WS-I
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-PERFORM
           GOBACK.
