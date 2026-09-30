       IDENTIFICATION DIVISION.
       PROGRAM-ID. RESPMAP.
      * A failed READ puts its RESP on the error line of the map.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-RESP        PIC S9(8) COMP.
       01 WS-REC         PIC X(80).
       01 WS-KEY         PIC X(8).
       01 ACCTMI.
          05 FILLER      PIC X(12).
          05 ERRMSGL     PIC S9(4) COMP.
          05 ERRMSGF     PIC X.
          05 ERRMSGI     PIC X(40).
       01 ACCTMO REDEFINES ACCTMI.
          05 FILLER      PIC X(15).
          05 ERRMSGO     PIC X(40).
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('ACCTDAT') INTO(WS-REC) RIDFLD(WS-KEY)
                RESP(WS-RESP) END-EXEC
           IF WS-RESP NOT = DFHRESP(NORMAL)
              MOVE WS-RESP TO ERRMSGO
              EXEC CICS SEND MAP('ACCTM') MAPSET('ACCTS') ERASE
              END-EXEC
           END-IF
           EXEC CICS RETURN END-EXEC.
