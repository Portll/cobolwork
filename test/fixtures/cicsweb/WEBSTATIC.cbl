       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBSTATIC.
      * Answers its caller with a fixed page, and names its own queue.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-PAGE             PIC X(200) VALUE '<p>ok</p>'.
       01 WS-QNAME            PIC X(16) VALUE 'AUDITLOG'.
       01 WS-ITEM             PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           MOVE WS-FORM TO WS-ITEM
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS WRITEQ TS QNAME(WS-QNAME) FROM(WS-ITEM)
                LENGTH(80) END-EXEC
           EXEC CICS RETURN END-EXEC.
