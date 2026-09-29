       IDENTIFICATION DIVISION.
       PROGRAM-ID. SIGNTELL.
      * Answers the two failures differently, so the reply says which.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-MESSAGE          PIC X(40).
       01 WS-USER-PWD         PIC X(08).
       01 SEC-USR-PWD         PIC X(08).
       01 WS-RESP             PIC S9(8) COMP.
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('USRSEC') INTO(SEC-USR-PWD)
                RIDFLD(WS-USER-PWD) RESP(WS-RESP) END-EXEC
           IF WS-RESP NOT = 0
               MOVE 'User not found. Try again ...' TO WS-MESSAGE
           ELSE
               IF SEC-USR-PWD NOT = WS-USER-PWD
                   MOVE 'Wrong Password. Try again ...' TO WS-MESSAGE
               END-IF
           END-IF
           EXEC CICS RETURN END-EXEC.
