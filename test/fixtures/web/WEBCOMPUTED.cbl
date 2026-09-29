       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBCOMPUTED.
      * Every header name is built at run time, so what it sets cannot
      * be read from the source.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NAME             PIC X(32).
       01 WS-VALUE            PIC X(64).
       01 WS-PAGE             PIC X(200).
       PROCEDURE DIVISION.
           MOVE 'X-Frame-Options' TO WS-NAME
           MOVE 'DENY' TO WS-VALUE
           EXEC CICS WEB WRITE HTTPHEADER(WS-NAME) NAMELENGTH(32)
                VALUE(WS-VALUE) VALUELENGTH(64) END-EXEC
           MOVE '<html><body>hi</body></html>' TO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS RETURN END-EXEC.
