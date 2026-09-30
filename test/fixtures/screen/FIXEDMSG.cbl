       IDENTIFICATION DIVISION.
       PROGRAM-ID. FIXEDMSG.
      * The same failure answered with the program's own words.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-RESP        PIC S9(8) COMP.
       01 WS-REC         PIC X(80).
       01 WS-KEY         PIC X(8).
       01 WS-MSG         PIC X(40).
       PROCEDURE DIVISION.
           EXEC CICS READ FILE('ACCTDAT') INTO(WS-REC) RIDFLD(WS-KEY)
                RESP(WS-RESP) END-EXEC
           EVALUATE WS-RESP
             WHEN DFHRESP(NOTFND)
               MOVE 'No such account' TO WS-MSG
             WHEN OTHER
               MOVE 'The account could not be read' TO WS-MSG
           END-EVALUATE
           EXEC CICS SEND TEXT FROM(WS-MSG) LENGTH(40) ERASE END-EXEC
           EXEC CICS RETURN END-EXEC.
