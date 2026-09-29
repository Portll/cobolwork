       IDENTIFICATION DIVISION.
       PROGRAM-ID. CGIPOST.
      * A CGI program that reads its posted fields through a routine it
      * names the request method to, and shows the password back.
       DATA DIVISION.
       WORKING-STORAGE SECTION.
       01 REQ-AREA.
          05 REQ-METHOD       PIC X(4).
          05 REQ-BODY         PIC X(200).
       01 WS-FIELD            PIC X(40).
       01 WS-USER-PWD         PIC X(16).
       PROCEDURE DIVISION.
           MOVE "POST" TO REQ-METHOD
           CALL "READREQ" USING REQ-AREA
           MOVE REQ-BODY TO WS-FIELD
           UNSTRING WS-FIELD DELIMITED BY "=" INTO WS-USER-PWD
           DISPLAY "Content-type: text/html"
           DISPLAY ""
           DISPLAY "<br>" WS-USER-PWD
           GOBACK.
