       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPFROM.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 10
              MOVE 'X' TO WS-ENTRY(WS-I)
           END-PERFORM
           GOBACK.
