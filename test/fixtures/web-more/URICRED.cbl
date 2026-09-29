       IDENTIFICATION DIVISION.
       PROGRAM-ID. URICRED.
      * Puts the credential in the query string, twice over.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PATH             PIC X(120).
       01 WS-API-PASSWORD     PIC X(16).
       01 WS-SESS             PIC X(8).
       PROCEDURE DIVISION.
           STRING '/pay?acct=1&password=' WS-API-PASSWORD
                DELIMITED BY SIZE INTO WS-PATH
           EXEC CICS WEB OPEN HOST('pay.example') HOSTLENGTH(11)
                SESSTOKEN(WS-SESS) END-EXEC
           EXEC CICS RETURN END-EXEC.
