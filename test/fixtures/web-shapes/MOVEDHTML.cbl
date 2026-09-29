       IDENTIFICATION DIVISION.
       PROGRAM-ID. MOVEDHTML.
      * A media type chosen at run time, with HTML in the document.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-MEDIA            PIC X(20).
       01 WS-PAGE             PIC X(200).
       PROCEDURE DIVISION.
           MOVE 'text/html' TO WS-MEDIA
           MOVE '<html><body>hi</body></html>' TO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE(WS-MEDIA) END-EXEC
           EXEC CICS RETURN END-EXEC.
