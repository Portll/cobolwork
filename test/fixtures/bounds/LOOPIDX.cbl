       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOPIDX.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN               PIC X(10).
       01 WS-I                PIC 9(4).
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-IN FROM COMMAND-LINE
           PERFORM VARYING WS-I FROM 1 BY 1 UNTIL WS-I > 10
              MOVE WS-IN TO WS-ENTRY(WS-I)
           END-PERFORM
           GOBACK.
