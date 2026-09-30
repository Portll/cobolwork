       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOGTD.
      * An error handler writes a line to the CSMT log and lets a failure pass.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-LINE        PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS WRITEQ TD QUEUE('CSMT') FROM(WS-LINE) LENGTH(80)
                NOHANDLE END-EXEC
           EXEC CICS RETURN END-EXEC.
