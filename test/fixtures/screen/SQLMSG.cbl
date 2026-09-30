       IDENTIFICATION DIVISION.
       PROGRAM-ID. SQLMSG.
      * A failed SELECT shows the terminal Db2's own message text.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
           EXEC SQL INCLUDE SQLCA END-EXEC.
       01 WS-ACCT        PIC X(10).
       01 WS-BAL         PIC S9(9)V99 COMP-3.
       01 WS-MSG         PIC X(80).
       PROCEDURE DIVISION.
           EXEC SQL SELECT BALANCE INTO :WS-BAL FROM ACCOUNTS
                    WHERE ACCT_ID = :WS-ACCT END-EXEC
           IF SQLCODE NOT = 0
              MOVE SQLERRMC TO WS-MSG
              EXEC CICS SEND TEXT FROM(WS-MSG) LENGTH(80) ERASE
              END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
