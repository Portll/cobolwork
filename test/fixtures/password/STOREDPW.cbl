       IDENTIFICATION DIVISION.
       PROGRAM-ID. STOREDPW.
      * The sign-on reads the user's record and compares its password.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-USER-ID     PIC X(8).
          05 WS-USER-PWD    PIC X(8).
       01 SEC-USER-DATA.
          05 SEC-USR-ID     PIC X(8).
          05 SEC-USR-PWD    PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EXEC CICS READ FILE('USRSEC') INTO(SEC-USER-DATA)
                RIDFLD(WS-USER-ID) END-EXEC
           IF SEC-USR-PWD = WS-USER-PWD
              EXEC CICS XCTL PROGRAM('MENU') END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
