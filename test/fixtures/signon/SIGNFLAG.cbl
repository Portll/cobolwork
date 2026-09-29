       IDENTIFICATION DIVISION.
       PROGRAM-ID. SIGNFLAG.
      * The comparison sets a flag and a later test of it transfers; the
      * flag is not followed, so neither route is said to bypass it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-USER-PWD         PIC X(8).
       01 SEC-USR-PWD         PIC X(8).
       01 WS-OK               PIC X VALUE 'N'.
          88 SIGNED-ON        VALUE 'Y'.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-USER-PWD) END-EXEC
           IF SEC-USR-PWD = WS-USER-PWD
              MOVE 'Y' TO WS-OK
           END-IF
           IF SIGNED-ON
              EXEC CICS XCTL PROGRAM('MENUPGM') END-EXEC
           END-IF
           IF EIBAID = DFHPF5
              EXEC CICS XCTL PROGRAM('MENUPGM') END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
