       IDENTIFICATION DIVISION.
       PROGRAM-ID. SQLFIXED.
      * The location is the program's own; the terminal only picks a user.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-INPUT.
          05 WS-USER     PIC X(8).
       01 WS-LOC         PIC X(16) VALUE 'DSNPROD'.
       01 WS-PW          PIC X(8).
       PROCEDURE DIVISION.
           EXEC CICS RECEIVE INTO(WS-INPUT) LENGTH(LENGTH OF WS-INPUT)
           END-EXEC
           EXEC SQL CONNECT TO :WS-LOC USER :WS-USER USING :WS-PW
           END-EXEC
           EXEC CICS RETURN END-EXEC.
