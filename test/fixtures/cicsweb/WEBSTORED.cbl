       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBSTORED.
      * Answers with a stored value twice: once as a page, once as
      * data. Only the page can carry script.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-NAME             PIC X(40).
       01 WS-PAGE             PIC X(200).
       01 WS-PLAIN            PIC X(200).
       PROCEDURE DIVISION.
           EXEC SQL SELECT CUSTNAME INTO :WS-NAME FROM CUSTOMER
                WHERE ID = 1 END-EXEC
           STRING '<p>' WS-NAME '</p>' DELIMITED BY SIZE INTO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE('text/html') END-EXEC
           MOVE WS-NAME TO WS-PLAIN
           EXEC CICS WEB SEND FROM(WS-PLAIN) FROMLENGTH(200)
                MEDIATYPE('text/plain') END-EXEC
           EXEC CICS RETURN END-EXEC.
