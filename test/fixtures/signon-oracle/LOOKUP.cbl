       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOOKUP.
      * Not a sign-on: no password anywhere, so "not found" tells nobody anything.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-MESSAGE          PIC X(40).
       01 WS-ACCT             PIC X(11).
       01 WS-RESP             PIC S9(8) COMP.
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('ACCTDAT') INTO(WS-ACCT)
                RIDFLD(WS-ACCT) RESP(WS-RESP) END-EXEC
           IF WS-RESP NOT = 0
               MOVE 'User not found. Try again ...' TO WS-MESSAGE
           END-IF
           EXEC CICS RETURN END-EXEC.
