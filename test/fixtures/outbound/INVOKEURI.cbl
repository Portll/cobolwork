       IDENTIFICATION DIVISION.
       PROGRAM-ID. INVOKEURI.
      * Where the service call goes is whatever the web request said.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-URL              PIC X(200).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-URL) END-EXEC
           EXEC CICS INVOKE WEBSERVICE('LOOKUP') CHANNEL('C')
                OPERATION('get') URI(WS-URL) END-EXEC
           EXEC CICS RETURN END-EXEC.
