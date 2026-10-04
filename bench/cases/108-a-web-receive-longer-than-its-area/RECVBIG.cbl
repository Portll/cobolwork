       IDENTIFICATION DIVISION.
       PROGRAM-ID. RECVBIG.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01  WS-TOK      PIC X(8).
       01  WS-BODY     PIC X(1000).
       01  WS-GOT      PIC S9(8) BINARY.
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE
               INTO(WS-BODY)
               MAXLENGTH(32000)
               LENGTH(WS-GOT)
           END-EXEC
           EXEC CICS RETURN END-EXEC.
