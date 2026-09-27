       IDENTIFICATION DIVISION.
       PROGRAM-ID. CGISID.
      * Issues a session cookie in its response, and logs to stderr.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 WS-SESSION-TOKEN    PIC X(32).
       01 WS-SQL-PASSWORD     PIC X(16).
       PROCEDURE DIVISION.
           ACCEPT WS-SQL-PASSWORD FROM ENVIRONMENT "SQL_PASSWORD"
           MOVE FUNCTION RANDOM TO WS-SESSION-TOKEN
           DISPLAY "Status: 302 Found"
           DISPLAY "Set-Cookie: SID=" FUNCTION TRIM(WS-SESSION-TOKEN)
           DISPLAY "Content-Type: text/html"
           DISPLAY "connect failed: " WS-SQL-PASSWORD UPON SYSERR
           GOBACK.
