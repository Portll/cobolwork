       IDENTIFICATION DIVISION.
       PROGRAM-ID. IGNORE.
      * Every error condition is set aside for the whole task.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-REC         PIC X(80).
       01 WS-KEY         PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS IGNORE CONDITION ERROR END-EXEC
           EXEC CICS READ FILE('ACCTDAT') INTO(WS-REC) RIDFLD(WS-KEY)
           END-EXEC
           EXEC CICS RETURN END-EXEC.
