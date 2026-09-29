       IDENTIFICATION DIVISION.
       PROGRAM-ID. HDRPARA.
      * Headers written in a paragraph performed before the send.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-DOC              PIC X(16).
       PROCEDURE DIVISION.
       MAIN-PARA.
           PERFORM WRITE-HEADERS
           EXEC CICS DOCUMENT CREATE DOCTOKEN(WS-DOC)
                TEXT('<html><body>ok</body></html>') LENGTH(28)
           END-EXEC
           EXEC CICS WEB SEND DOCTOKEN(WS-DOC) END-EXEC
           EXEC CICS RETURN END-EXEC.
       WRITE-HEADERS.
           EXEC CICS WEB WRITE HTTPHEADER('Content-Security-Policy')
                VALUE('default-src self') VALUELENGTH(16) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('X-Frame-Options')
                VALUE('DENY') VALUELENGTH(4) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('X-Content-Type-Options')
                VALUE('nosniff') VALUELENGTH(7) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('Cache-Control')
                VALUE('no-store') VALUELENGTH(8) END-EXEC.
