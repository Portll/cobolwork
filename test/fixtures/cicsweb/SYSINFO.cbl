       IDENTIFICATION DIVISION.
       PROGRAM-ID. SYSINFO.
      * What CICS says about the region and an abend may reach only a
      * caller outside; the user's own id and an access decision never.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-APPL             PIC X(8).
       01 WS-USER             PIC X(8).
       01 WS-ABEND            PIC X(4).
       01 WS-DSN              PIC X(44).
       01 WS-ACCESS           PIC S9(8) COMP.
       PROCEDURE DIVISION.
           EXEC CICS ASSIGN APPLID(WS-APPL) USERID(WS-USER)
                ABCODE(WS-ABEND) END-EXEC
           EXEC CICS INQUIRE FILE('CUSTF') DSNAME(WS-DSN) END-EXEC
           EXEC CICS QUERY SECURITY RESTYPE('FILE')
                RESID('CUSTF') READ(WS-ACCESS) END-EXEC
           EXEC CICS WEB SEND FROM(WS-APPL) END-EXEC
           EXEC CICS WEB SEND FROM(WS-DSN) END-EXEC
           EXEC CICS WEB SEND FROM(WS-ABEND) END-EXEC
           EXEC CICS WEB SEND FROM(WS-USER) END-EXEC
           EXEC CICS WEB SEND FROM(WS-ACCESS) END-EXEC
           EXEC CICS SEND TEXT FROM(WS-APPL) END-EXEC
           EXEC CICS RETURN END-EXEC.
