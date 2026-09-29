       IDENTIFICATION DIVISION.
       PROGRAM-ID. ACCTUPD.
      * Every name used below is declared here, or supplied by the
      * CICS translator, the Db2 precompiler or the compiler itself.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-RESP                 PIC S9(8) COMP.
       01  WS-BALANCE              PIC S9(9)V99 COMP-3.
       01  WS-MESSAGE              PIC X(40).
       01  WS-RATES.
           05  WS-RATE             PIC 9V999 OCCURS 5 TIMES
                                   INDEXED BY RATE-IX.
           EXEC SQL INCLUDE SQLCA END-EXEC.
       LINKAGE SECTION.
       01  DFHCOMMAREA.
           05  CA-ACCOUNT          PIC X(10).
           05  CA-AMOUNT           PIC S9(7)V99 COMP-3.
           05  CA-STATUS           PIC X.
               88  CA-DONE         VALUE 'Y'.
       PROCEDURE DIVISION.
       MAIN-PARA.
           IF EIBCALEN < LENGTH OF DFHCOMMAREA
               MOVE 'COMMAREA TOO SHORT' TO WS-MESSAGE
               PERFORM SEND-AND-RETURN
           END-IF
           EXEC SQL SELECT BALANCE INTO :WS-BALANCE
               FROM ACCOUNT WHERE ACCOUNT_ID = :CA-ACCOUNT
           END-EXEC
           IF SQLCODE NOT = 0 OR SQLSTATE NOT = '00000'
               MOVE 'ACCOUNT NOT READ' TO WS-MESSAGE
               PERFORM SEND-AND-RETURN
           END-IF
           SET RATE-IX TO 1
           COMPUTE WS-BALANCE = WS-BALANCE
                              + CA-AMOUNT * WS-RATE (RATE-IX)
           EXEC SQL UPDATE ACCOUNT SET BALANCE = :WS-BALANCE
               WHERE ACCOUNT_ID = :CA-ACCOUNT
           END-EXEC
           SET CA-DONE TO TRUE
           EXEC CICS SYNCPOINT RESP(WS-RESP) END-EXEC
           IF WS-RESP NOT = DFHRESP(NORMAL)
               MOVE 'SYNCPOINT FAILED' TO WS-MESSAGE
               MOVE 8 TO RETURN-CODE
           END-IF
           PERFORM SEND-AND-RETURN.
       SEND-AND-RETURN.
           EXEC CICS SEND TEXT FROM(WS-MESSAGE) LENGTH(40) ERASE
           END-EXEC
           EXEC CICS RETURN END-EXEC.
