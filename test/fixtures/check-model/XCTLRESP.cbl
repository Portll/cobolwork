       IDENTIFICATION DIVISION.
       PROGRAM-ID. XCTLRESP.
      * With RESP, an XCTL that fails comes back, and the statement after
      * it runs.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-LEN              PIC S9(4) COMP VALUE 4.
       01 WS-RESP             PIC S9(8) COMP.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-I) LENGTH(WS-LEN) END-EXEC
           EXEC CICS XCTL PROGRAM('NEXTPGM') RESP(WS-RESP) END-EXEC
           MOVE 'X' TO WS-ENTRY(WS-I)
           EXEC CICS RETURN END-EXEC.
