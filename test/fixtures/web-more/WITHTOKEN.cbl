       IDENTIFICATION DIVISION.
       PROGRAM-ID. WITHTOKEN.
      * The same change, guarded by a token the program issued.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-REC              PIC X(80).
       01 WS-CSRF-TOKEN       PIC X(32).
       01 WS-SENT-TOKEN       PIC X(32).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           IF WS-SENT-TOKEN = WS-CSRF-TOKEN
               EXEC CICS REWRITE FILE('ACCTDAT') FROM(WS-REC)
                    LENGTH(80) END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
