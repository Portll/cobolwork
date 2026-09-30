       IDENTIFICATION DIVISION.
       PROGRAM-ID. COMPARED.
      * The UPDATE runs only where the token matches the one issued.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-ACCT             PIC X(10).
       01 WS-AMT              PIC S9(9)V99 COMP-3.
       01 WS-SENT-TOKEN       PIC X(32).
       01 WS-ISSUED-TOKEN     PIC X(32).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           EVALUATE WS-SENT-TOKEN
             WHEN WS-ISSUED-TOKEN
               EXEC SQL
                   UPDATE ACCOUNTS SET BALANCE = BALANCE - :WS-AMT
                   WHERE ACCT_ID = :WS-ACCT
               END-EXEC
           END-EVALUATE
           EXEC CICS RETURN END-EXEC.
