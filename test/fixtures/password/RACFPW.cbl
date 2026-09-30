       IDENTIFICATION DIVISION.
       PROGRAM-ID. RACFPW.
      * The same sign-on, with RACF checking the password.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-USER-ID     PIC X(8).
          05 WS-USER-PWD    PIC X(8).
       01 SEC-USER-DATA.
          05 SEC-USR-ID     PIC X(8).
          05 SEC-USR-PWD    PIC X(8).
       01 WS-RESP           PIC S9(8) COMP.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EXEC CICS VERIFY PASSWORD(WS-USER-PWD) USERID(WS-USER-ID)
                RESP(WS-RESP) END-EXEC
           IF WS-RESP = DFHRESP(NORMAL)
              EXEC CICS XCTL PROGRAM('MENU') END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
