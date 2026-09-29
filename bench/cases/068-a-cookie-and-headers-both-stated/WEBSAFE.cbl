       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBSAFE.
      * The same page, with every attribute and every header stated.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PAGE             PIC X(200).
       PROCEDURE DIVISION.
           EXEC CICS WEB WRITE HTTPHEADER('Set-Cookie')
                VALUE('S=A1; Secure; HttpOnly; SameSite=Lax')
                VALUELENGTH(36) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('Content-Security-Policy')
                VALUE('default-src self') VALUELENGTH(16) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('X-Frame-Options')
                VALUE('DENY') VALUELENGTH(4) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('X-Content-Type-Options')
                VALUE('nosniff') VALUELENGTH(7) END-EXEC
           EXEC CICS WEB WRITE HTTPHEADER('Cache-Control')
                VALUE('no-store') VALUELENGTH(8) END-EXEC
           MOVE '<html><body>Welcome</body></html>' TO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS RETURN END-EXEC.
