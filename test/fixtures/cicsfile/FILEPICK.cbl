       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILEPICK.
      * Reads and browses whichever file the terminal names.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-IN.
          05 WS-IN-FILE       PIC X(8).
          05 WS-IN-KEY        PIC X(10).
       01 WS-FILE             PIC X(8).
       01 WS-KEY              PIC X(10).
       01 WS-REC              PIC X(200).
       01 WS-LEN              PIC S9(4) COMP VALUE 18.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-IN) LENGTH(WS-LEN) END-EXEC
           MOVE WS-IN-FILE TO WS-FILE
           MOVE WS-IN-KEY TO WS-KEY
           EXEC CICS READ FILE(WS-FILE) INTO(WS-REC) RIDFLD(WS-KEY)
           END-EXEC
           EXEC CICS STARTBR DATASET(WS-FILE) RIDFLD(WS-KEY) END-EXEC
           EXEC CICS READNEXT FILE(WS-FILE) INTO(WS-REC)
                RIDFLD(WS-KEY) END-EXEC
           EXEC CICS ENDBR FILE(WS-FILE) END-EXEC
           EXEC CICS RETURN END-EXEC.
