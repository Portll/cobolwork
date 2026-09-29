       IDENTIFICATION DIVISION.
       PROGRAM-ID. MENU.
      * Started by MNU1. Transfers to the report program by name, and to
      * a second program through a variable that holds its name.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NEXT             PIC X(8).
       PROCEDURE DIVISION.
           MOVE 'SPELLED' TO WS-NEXT
           EXEC CICS XCTL PROGRAM('REPORTS') END-EXEC
           EXEC CICS XCTL PROGRAM(WS-NEXT) END-EXEC.
