       IDENTIFICATION DIVISION.
       PROGRAM-ID. XCTLDONE.
      * Without RESP or NOHANDLE, control does not come back from XCTL.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-LEN              PIC S9(4) COMP VALUE 4.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-I) LENGTH(WS-LEN) END-EXEC
           EXEC CICS XCTL PROGRAM('NEXTPGM') END-EXEC
           MOVE 'X' TO WS-ENTRY(WS-I)
           EXEC CICS RETURN END-EXEC.
