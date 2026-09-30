       IDENTIFICATION DIVISION.
       PROGRAM-ID. XMLOWN.
      * A document the program built itself, parsed back.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-DOC      PIC X(200).
       01 WS-REQ      PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-REQ) LENGTH(LENGTH OF WS-REQ)
           END-EXEC
           MOVE '<order><id>1</id></order>' TO WS-DOC
           XML PARSE WS-DOC PROCESSING PROCEDURE HANDLER
           END-XML
           EXEC CICS RETURN END-EXEC.
       HANDLER.
           CONTINUE.
