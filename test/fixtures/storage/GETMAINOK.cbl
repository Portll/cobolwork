       IDENTIFICATION DIVISION.
       PROGRAM-ID. GETMAINOK.
      * The same request, refused above the program's own ceiling.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-LEN     PIC S9(8) COMP.
       01 WS-PTR        USAGE POINTER.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           IF WS-LEN > 32000
              EXEC CICS RETURN END-EXEC
           END-IF
           EXEC CICS GETMAIN SET(WS-PTR) FLENGTH(WS-LEN)
           END-EXEC
           EXEC CICS RETURN END-EXEC.
