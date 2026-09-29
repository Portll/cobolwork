       IDENTIFICATION DIVISION.
       PROGRAM-ID. SIGNSAME.
      * The same sign-on, answering both failures with one message.
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
               MOVE 'Incorrect username or password' TO WS-MESSAGE
           ELSE
               IF SEC-USR-PWD NOT = WS-USER-PWD
                   MOVE 'Incorrect username or password' TO WS-MESSAGE
               END-IF
           END-IF
           EXEC CICS RETURN END-EXEC.
