       IDENTIFICATION DIVISION.
       PROGRAM-ID. NESTGOBK.
      * The GOBACK in the nested program returns to the caller, which
      * carries on to its use.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4) GLOBAL.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           CALL 'CHECKER'
           MOVE 'X' TO WS-ENTRY(WS-I)
           GOBACK.
       IDENTIFICATION DIVISION.
       PROGRAM-ID. CHECKER.
       PROCEDURE DIVISION.
           IF WS-I < 1 OR WS-I > 10
              GOBACK
           END-IF
           EXIT PROGRAM.
       END PROGRAM CHECKER.
       END PROGRAM NESTGOBK.
