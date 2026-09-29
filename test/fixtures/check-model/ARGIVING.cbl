       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARGIVING.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-D                PIC 9.
       01 WS-I                PIC 9(4).
       01 WS-J                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-D
           ADD 1 WS-D GIVING WS-I
           MOVE 'X' TO WS-ENTRY(WS-I)
           SUBTRACT WS-D FROM 10 GIVING WS-J
           MOVE 'Y' TO WS-ENTRY(WS-J)
           GOBACK.
