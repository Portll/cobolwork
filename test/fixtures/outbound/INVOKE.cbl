       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVOKE.
      * A customer row goes in a container on a channel, and a service
      * call sends the channel to a remote service.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-CUST             PIC X(80).
       01 WS-NOTE             PIC X(20) VALUE 'UNRELATED'.
       PROCEDURE DIVISION.
           EXEC SQL SELECT CUST_DATA INTO :WS-CUST FROM CUST END-EXEC
           EXEC CICS PUT CONTAINER('DFHWS-DATA') CHANNEL('SVC')
                FROM(WS-CUST) END-EXEC
           EXEC CICS PUT CONTAINER('NOTE') CHANNEL('OTHER')
                FROM(WS-NOTE) END-EXEC
           EXEC CICS INVOKE SERVICE('CUSTSVC') CHANNEL('SVC')
                OPERATION('update') END-EXEC
           EXEC CICS RETURN END-EXEC.
