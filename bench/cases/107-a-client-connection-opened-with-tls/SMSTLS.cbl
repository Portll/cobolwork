       IDENTIFICATION DIVISION.
       PROGRAM-ID. SMSTLS.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-TOK      PIC X(8).
       01  WS-HOST     PIC X(15) VALUE 'sms.example'.
       PROCEDURE DIVISION.
           EXEC CICS WEB OPEN
               HOST(WS-HOST)
               SCHEME(HTTPS)
               SESSTOKEN(WS-TOK)
           END-EXEC
           EXEC CICS RETURN END-EXEC.
