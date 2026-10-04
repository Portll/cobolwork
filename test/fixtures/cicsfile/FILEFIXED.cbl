       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILEFIXED.
      * The terminal chooses the record, never the file: the file
      * name is a literal, a constant, or one of two the program
      * checks it against.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN.
          05 WS-IN-FILE       PIC X(8).
          05 WS-IN-KEY        PIC X(10).
       01 WS-FILE             PIC X(8).
       01 LIT-ACCTFILE        PIC X(8) VALUE 'ACCTDAT '.
       01 WS-KEY              PIC X(10).
       01 WS-REC              PIC X(200).
       01 WS-LEN              PIC S9(4) COMP VALUE 18.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-IN) LENGTH(WS-LEN) END-EXEC
           MOVE WS-IN-KEY TO WS-KEY
           EXEC CICS READ FILE('CUSTDAT') INTO(WS-REC) RIDFLD(WS-KEY)
           END-EXEC
           EXEC CICS READ FILE(LIT-ACCTFILE) INTO(WS-REC)
                RIDFLD(WS-KEY) END-EXEC
           MOVE 'CARDDAT ' TO WS-FILE
           EXEC CICS DELETE FILE(WS-FILE) RIDFLD(WS-KEY) END-EXEC
           IF WS-IN-FILE = 'ACCTDAT ' OR 'CUSTDAT '
              MOVE WS-IN-FILE TO WS-FILE
              EXEC CICS READ FILE(WS-FILE) INTO(WS-REC)
                   RIDFLD(WS-KEY) END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
