       IDENTIFICATION DIVISION.
       PROGRAM-ID. UNTILRIGHT.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-DONE             PIC X.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           PERFORM VARYING WS-I FROM 1 BY 1
              UNTIL WS-ENTRY(WS-I) = 'X' OR WS-I > 10
              CONTINUE
           END-PERFORM
           GOBACK.
