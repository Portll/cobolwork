       IDENTIFICATION DIVISION.
       PROGRAM-ID. ARGIVBIG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(9).
       01 WS-D                PIC 9.
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           MOVE WS-IN TO WS-D
           MULTIPLY WS-D BY 2 GIVING WS-I
           ADD 1 TO WS-I
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
