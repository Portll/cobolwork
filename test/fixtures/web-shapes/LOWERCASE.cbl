       IDENTIFICATION DIVISION.
       PROGRAM-ID. LOWERCASE.
      * A cookie whose attributes are correct but lower case.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-PAGE             PIC X(100).
       PROCEDURE DIVISION.
           EXEC CICS WEB WRITE HTTPHEADER('set-cookie')
                VALUE('s=1; secure; httponly; samesite=lax')
                VALUELENGTH(35) END-EXEC
           MOVE '<html>x</html>' TO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(100)
                MEDIATYPE('text/html') END-EXEC
           EXEC CICS RETURN END-EXEC.
