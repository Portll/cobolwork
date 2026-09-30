       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOHANDLE.
      * Reads and rewrites a record without looking at either outcome.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC         PIC X(80).
       01 WS-KEY         PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('ACCTDAT') INTO(WS-REC) RIDFLD(WS-KEY)
                UPDATE NOHANDLE END-EXEC
           MOVE 'X' TO WS-REC(1:1)
           EXEC CICS REWRITE FILE('ACCTDAT') FROM(WS-REC) NOHANDLE
           END-EXEC
           EXEC CICS DELETEQ TS QUEUE('SCRATCH') NOHANDLE END-EXEC
           EXEC CICS RETURN END-EXEC.
