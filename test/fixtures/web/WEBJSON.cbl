       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBJSON.
      * A data reply. Nothing frames it and nothing sniffs it into script.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-BODY             PIC X(200).
       PROCEDURE DIVISION.
           MOVE '{"balance":100}' TO WS-BODY
           EXEC CICS WEB SEND FROM(WS-BODY) FROMLENGTH(200)
                MEDIATYPE('application/json') END-EXEC
           EXEC CICS RETURN END-EXEC.
