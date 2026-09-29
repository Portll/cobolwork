       IDENTIFICATION DIVISION.
       PROGRAM-ID. ADDAFTERUSE.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-DONE             PIC X.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           ACCEPT WS-I FROM COMMAND-LINE
           MOVE 0 TO WS-I
           PERFORM UNTIL WS-DONE = 'Y'
              IF WS-I > 10
                 STOP RUN
              END-IF
              MOVE 'X' TO WS-ENTRY(WS-I)
              ADD 1 TO WS-I
              ACCEPT WS-DONE FROM COMMAND-LINE
           END-PERFORM
           GOBACK.
