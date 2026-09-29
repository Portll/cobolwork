       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBCOOKIE.
      * Sets a session cookie, and says nothing about how it travels.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PAGE             PIC X(200).
       PROCEDURE DIVISION.
           EXEC CICS WEB WRITE HTTPHEADER('Set-Cookie')
                VALUE('SESSID=A1B2C3; Path=/') VALUELENGTH(21)
           END-EXEC
           MOVE '<html><body>Welcome</body></html>' TO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS RETURN END-EXEC.
