       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBLINK.
      * Builds a document with a link that opens a window keeping a
      * handle back to this one.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-DOC              PIC X(16).
       PROCEDURE DIVISION.
           EXEC CICS DOCUMENT CREATE DOCTOKEN(WS-DOC)
                TEXT('<html><body><a href="/x" target="_blank">go</a>')
                LENGTH(46) END-EXEC
           EXEC CICS WEB SEND DOCTOKEN(WS-DOC)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS RETURN END-EXEC.
