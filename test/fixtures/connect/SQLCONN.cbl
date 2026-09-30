       IDENTIFICATION DIVISION.
       PROGRAM-ID. SQLCONN.
      * The terminal names the Db2 location the program connects to.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-LOC      PIC X(16).
       01 WS-USER        PIC X(8) VALUE 'APPUSER'.
       01 WS-PW          PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EXEC SQL CONNECT TO :WS-LOC USER :WS-USER USING :WS-PW
           END-EXEC
           EXEC CICS RETURN END-EXEC.
