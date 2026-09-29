       IDENTIFICATION DIVISION.
       PROGRAM-ID. TELLS.
      * Names the software answering, and keeps the page after the session.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PAGE             PIC X(100).
       PROCEDURE DIVISION.
           EXEC CICS WEB WRITE HTTPHEADER('Server')
                VALUE('CICS TS 5.6') VALUELENGTH(11) END-EXEC
           MOVE '<html>ok</html>' TO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(100)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS RETURN END-EXEC.
