       IDENTIFICATION DIVISION.
       PROGRAM-ID. CICSTOK.
      * A token CICS verifies, then writes to a queue, beside the
      * handle of an outbound web session.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-TOKEN            PIC X(64).
       01 WS-CONN-TOKEN       PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS VERIFY TOKEN(WS-TOKEN) TOKENLEN(64)
                END-EXEC
           EXEC CICS WRITEQ TD QUEUE('CSSL') FROM(WS-TOKEN)
                LENGTH(64) END-EXEC
           EXEC CICS WEB OPEN URIMAP('URIGET')
                SESSTOKEN(WS-CONN-TOKEN) END-EXEC
           DISPLAY 'WEB OPEN OK - Token: ' WS-CONN-TOKEN
           EXEC CICS RETURN END-EXEC.
