       IDENTIFICATION DIVISION.
       PROGRAM-ID. SQLUPD.
      * A web request moves money with an UPDATE, and checks nothing.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-ACCT             PIC X(10).
       01 WS-AMT              PIC S9(9)V99 COMP-3.
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           EXEC SQL
               UPDATE ACCOUNTS SET BALANCE = BALANCE - :WS-AMT
               WHERE ACCT_ID = :WS-ACCT
           END-EXEC
           EXEC CICS RETURN END-EXEC.
