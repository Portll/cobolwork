       IDENTIFICATION DIVISION.
       PROGRAM-ID. ONEXCP.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-I                PIC 9(4).
       01 WS-LEN              PIC S9(4) COMP VALUE 4.
       01 WS-PGM              PIC X(8) VALUE 'SUBPGM'.
       01 WS-TABLE.
          05 WS-ENTRY         PIC X(10) OCCURS 10.
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-I) LENGTH(WS-LEN) END-EXEC
           CALL WS-PGM USING WS-I
              ON EXCEPTION
                 EXEC CICS RETURN END-EXEC
              NOT ON EXCEPTION
                 MOVE 'X' TO WS-ENTRY(WS-I)
           END-CALL
           EXEC CICS RETURN END-EXEC.
