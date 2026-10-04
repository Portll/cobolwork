       IDENTIFICATION DIVISION.
       PROGRAM-ID. FILEWEB.
      * Writes the posted record to the file the request names.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-FORM.
          05 WS-FORM-FILE     PIC X(8).
          05 WS-FORM-REC      PIC X(80).
       01 WS-FILE             PIC X(8).
       01 WS-KEY              PIC X(10) VALUE SPACES.
       PROCEDURE DIVISION.
           EXEC CICS WEB RECEIVE INTO(WS-FORM) LENGTH(LENGTH OF WS-FORM)
           END-EXEC
           MOVE WS-FORM-FILE TO WS-FILE
           EXEC CICS WRITE FILE(WS-FILE) FROM(WS-FORM-REC)
                RIDFLD(WS-KEY) END-EXEC
           EXEC CICS RETURN END-EXEC.
