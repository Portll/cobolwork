       IDENTIFICATION DIVISION.
       PROGRAM-ID. CGIECHO.
      * A CGI program that shows back the password its request carried,
      * the one on file for that user, and one that is either.
       ENVIRONMENT DIVISION.
       INPUT-OUTPUT SECTION.
       FILE-CONTROL.
           SELECT USER-FILE ASSIGN TO "users.dat".
       DATA DIVISION.
       FILE SECTION.
       FD USER-FILE.
       01 USER-REC.
          05 UR-NAME          PIC X(12).
          05 UR-PASSWORD      PIC X(16).
       WORKING-STORAGE SECTION.
       01 WS-QUERY            PIC X(80).
       01 WS-USER             PIC X(12).
       01 WS-PASSWORD         PIC X(16).
       01 WS-STORED-PASSWORD  PIC X(16).
       01 WS-SHOWN-PASSWORD   PIC X(16).
       PROCEDURE DIVISION.
           ACCEPT WS-QUERY FROM ENVIRONMENT "QUERY_STRING"
           UNSTRING WS-QUERY DELIMITED BY "&" INTO WS-USER WS-PASSWORD
           OPEN INPUT USER-FILE
           READ USER-FILE
           MOVE UR-PASSWORD TO WS-STORED-PASSWORD
           IF WS-PASSWORD = SPACES
               MOVE UR-PASSWORD TO WS-SHOWN-PASSWORD
           ELSE
               MOVE WS-PASSWORD TO WS-SHOWN-PASSWORD
           END-IF
           CLOSE USER-FILE
           DISPLAY "Content-Type: text/html"
           DISPLAY X"0A"
           DISPLAY "<p>You sent " WS-PASSWORD "</p>"
           DISPLAY "<p>On file " WS-STORED-PASSWORD "</p>"
           DISPLAY "<p>Shown " WS-SHOWN-PASSWORD "</p>"
           GOBACK.
