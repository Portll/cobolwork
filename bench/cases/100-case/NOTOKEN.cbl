       IDENTIFICATION DIVISION.
       PROGRAM-ID. NOTOKEN.
      * Changes state on a web request with nothing the browser could not forge.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-REC              PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           EXEC CICS REWRITE FILE('ACCTDAT') FROM(WS-REC)
                LENGTH(80) END-EXEC
           EXEC CICS RETURN END-EXEC.
