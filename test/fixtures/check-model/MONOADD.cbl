       IDENTIFICATION DIVISION.
       PROGRAM-ID. MONOADD.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-Y                PIC 9(4).
       01 WS-DONE             PIC X.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           MOVE 1 TO WS-I
           PERFORM UNTIL WS-I > 10
              MOVE 'X' TO WS-ENTRY(WS-I)
              ADD 1 TO WS-I
           END-PERFORM
           GOBACK.
