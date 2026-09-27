       IDENTIFICATION DIVISION.
       PROGRAM-ID. ATENDIF.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT IN-FILE ASSIGN TO INFILE.
       DATA DIVISION.
       FILE SECTION.
       FD IN-FILE.
       01 IN-REC               PIC X(10).
       WORKING-STORAGE SECTION.
       01 WS-I                 PIC 9(4).
       01 WS-COUNT             PIC 9(4) VALUE 0.
       01 WS-TABLE.
          05 WS-ENTRY          PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
       MAIN-PARA.
           ACCEPT WS-I FROM COMMAND-LINE
           OPEN INPUT IN-FILE.
       READ-PARA.
           READ IN-FILE
              AT END
                 IF WS-COUNT = 0
                    DISPLAY 'EMPTY INPUT'
                    GOBACK
                 ELSE
                    GO TO END-PARA
                 END-IF
              NOT AT END
                 MOVE IN-REC TO WS-ENTRY(WS-I)
           END-READ
           ADD 1 TO WS-COUNT
           GO TO READ-PARA.
       END-PARA.
           CLOSE IN-FILE
           GOBACK.
