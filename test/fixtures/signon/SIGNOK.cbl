       IDENTIFICATION DIVISION.
       PROGRAM-ID. SIGNOK.
      * The menu is reached only past the password comparison.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-USER-PWD         PIC X(8).
       01 SEC-USR-PWD         PIC X(8).
       01 WS-INPUT.
          05 IN-PWD           PIC X(8).
       PROCEDURE DIVISION.
       MAIN-PARA.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           EVALUATE EIBAID
              WHEN DFHENTER
                 PERFORM CHECK-PWD
              WHEN DFHPF3
                 EXEC CICS RETURN END-EXEC
              WHEN OTHER
                 EXEC CICS SEND TEXT FROM(WS-INPUT) END-EXEC
           END-EVALUATE
           EXEC CICS RETURN END-EXEC.
       CHECK-PWD.
           MOVE IN-PWD TO WS-USER-PWD
           EXEC CICS READ FILE('USRSEC') INTO(SEC-USR-PWD)
                RIDFLD(IN-PWD) END-EXEC
           IF SEC-USR-PWD = WS-USER-PWD
              EXEC CICS XCTL PROGRAM('MENUPGM') END-EXEC
           ELSE
              EXEC CICS SEND TEXT FROM(WS-INPUT) END-EXEC
           END-IF.
