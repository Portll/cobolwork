       IDENTIFICATION DIVISION.
       PROGRAM-ID. GETMAININ.
      * The terminal says how many bytes of storage to acquire.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-LEN     PIC S9(8) COMP.
       01 WS-PTR        USAGE POINTER.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EXEC CICS GETMAIN SET(WS-PTR) FLENGTH(WS-LEN)
           END-EXEC
           EXEC CICS RETURN END-EXEC.
