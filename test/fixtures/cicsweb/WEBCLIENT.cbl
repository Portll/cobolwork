       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBCLIENT.
      * Sends a record to a remote server on a session it opened: that
      * is data leaving, not a reply to its own caller.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT CUST-FILE ASSIGN TO CUSTIN.
       DATA DIVISION.
       FILE SECTION.
       FD CUST-FILE.
       01 CUST-REC            PIC X(80).
       WORKING-STORAGE SECTION.
       01 WS-BODY             PIC X(80).
       01 WS-SESS             PIC X(8).
       PROCEDURE DIVISION.
           OPEN INPUT CUST-FILE
           READ CUST-FILE
           MOVE CUST-REC TO WS-BODY
           EXEC CICS WEB OPEN HOST('reports.example.com') HOSTLENGTH(19)
                SESSTOKEN(WS-SESS) END-EXEC
           EXEC CICS WEB SEND FROM(WS-BODY) FROMLENGTH(80)
                SESSTOKEN(WS-SESS) END-EXEC
           CLOSE CUST-FILE
           EXEC CICS RETURN END-EXEC.
