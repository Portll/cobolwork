       IDENTIFICATION DIVISION.
       PROGRAM-ID. MENU.
      * CardDemo's menus: a loop counter scans the typed option back to
      * its last non-space, then a second loop lists the options. The
      * counter is compared with the input; it never receives it.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 OPTIONI          PIC X(2).
       01 WS-IDX              PIC S9(4) COMP.
       01 WS-OPTS.
          05 OPT-NAME         PIC X(10) OCCURS 5.
       01 WS-OUT              PIC X(10).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) END-EXEC
           PERFORM VARYING WS-IDX FROM 2 BY -1 UNTIL
                   OPTIONI(WS-IDX:1) NOT = SPACES OR WS-IDX = 1
           END-PERFORM
           PERFORM VARYING WS-IDX FROM 1 BY 1 UNTIL WS-IDX > 5
              MOVE OPT-NAME(WS-IDX) TO WS-OUT
           END-PERFORM
           EXEC CICS RETURN END-EXEC.
