       IDENTIFICATION DIVISION.
       PROGRAM-ID. WEBECHO.
      * Echoes what the request asked for into the reply, into a
      * header, into the host it then calls, and into a queue name.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM             PIC X(80).
       01 WS-PAGE             PIC X(200).
       01 WS-HEADER           PIC X(80).
       01 WS-HOST             PIC X(60).
       01 WS-QNAME            PIC X(16).
       01 WS-TOKEN            PIC X(8).
       01 WS-SESS             PIC X(8).
       01 WS-ITEM             PIC X(80).
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           STRING '<p>' WS-FORM '</p>' DELIMITED BY SIZE INTO WS-PAGE
           EXEC CICS WEB SEND FROM(WS-PAGE) FROMLENGTH(200)
                MEDIATYPE('text/html') END-EXEC
           MOVE WS-FORM TO WS-HEADER
           EXEC CICS WEB WRITE HTTPHEADER('X-Echo') VALUE(WS-HEADER)
                VALUELENGTH(80) END-EXEC
           MOVE WS-FORM TO WS-HOST
           EXEC CICS WEB OPEN HOST(WS-HOST) HOSTLENGTH(60)
                SESSTOKEN(WS-SESS) END-EXEC
           MOVE WS-FORM TO WS-QNAME
           EXEC CICS WRITEQ TS QNAME(WS-QNAME) FROM(WS-ITEM)
                LENGTH(80) END-EXEC
           EXEC CICS RETURN END-EXEC.
